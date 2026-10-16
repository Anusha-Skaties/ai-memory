# Deploys the site to Google Cloud Run with Firestore storage, optional Google Sheet copy,
# optional email alerts, and a password-protected stats page at /admin.
#
# First deploy (example):
#   .\deploy.ps1 -ProjectId my-gcp-project -AdminPassword "a-long-password" `
#     -SheetId 1AbC...xyz -NotifyTo you@gmail.com `
#     -SmtpHost smtp.gmail.com -SmtpPort 587 -SmtpUser you@gmail.com -SmtpPassword "gmail-app-password"
#
# Later deploys: .\deploy.ps1 -ProjectId my-gcp-project
# (passwords are kept in Secret Manager; pass a parameter again only to change it)
#
# Prereqs: gcloud CLI installed, `gcloud auth login` done, billing enabled on the project.
param(
  [Parameter(Mandatory = $true)][string]$ProjectId,
  [string]$Region = "us-central1",
  [string]$Service = "groundwork-site",
  [string]$FirestoreLocation = "nam5",
  [string]$AdminPassword,
  [string]$SheetId,
  [string]$SheetTab = "Bookings",
  [string]$NotifyTo,
  [string]$NotifyFrom,
  [string]$SmtpHost,
  [string]$SmtpPort = "587",
  [string]$SmtpUser,
  [string]$SmtpPassword
)
$ErrorActionPreference = "Stop"
$sa = "$Service-sa@$ProjectId.iam.gserviceaccount.com"

function Test-Secret([string]$Name) {
  $found = gcloud secrets list --filter="name:$Name" --format="value(name)"
  return [bool]$found
}

# Creates the secret if needed and adds a new version. Writes via a temp file so no
# trailing newline sneaks into the value.
function Set-Secret([string]$Name, [string]$Value) {
  if (-not (Test-Secret $Name)) {
    gcloud secrets create $Name --replication-policy=automatic | Out-Null
  }
  $tmp = [System.IO.Path]::GetTempFileName()
  try {
    [System.IO.File]::WriteAllText($tmp, $Value)
    gcloud secrets versions add $Name --data-file=$tmp | Out-Null
  } finally {
    Remove-Item $tmp -Force
  }
  gcloud secrets add-iam-policy-binding $Name --member="serviceAccount:$sa" --role="roles/secretmanager.secretAccessor" | Out-Null
}

Write-Host "==> Using project $ProjectId"
gcloud config set project $ProjectId

Write-Host "==> Enabling APIs"
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com `
  firestore.googleapis.com secretmanager.googleapis.com sheets.googleapis.com

Write-Host "==> Ensuring Firestore (default) database exists"
$dbs = gcloud firestore databases list --format="value(name)" 2>$null
if (-not ($dbs -match "/databases/\(default\)")) {
  gcloud firestore databases create --location=$FirestoreLocation --type=firestore-native
}

Write-Host "==> Auto-deleting daily visitor markers after 2 days (Firestore TTL)"
gcloud firestore fields ttls update expireAt --collection-group=stats_visitors --enable-ttl --async 2>$null | Out-Null

Write-Host "==> Ensuring service account $sa"
$existing = gcloud iam service-accounts list --filter="email:$sa" --format="value(email)"
if (-not $existing) {
  gcloud iam service-accounts create "$Service-sa" --display-name="$Service runtime"
}
gcloud projects add-iam-policy-binding $ProjectId --member="serviceAccount:$sa" --role="roles/datastore.user" --condition=None | Out-Null

Write-Host "==> Secrets"
if ($AdminPassword) { Set-Secret "admin-password" $AdminPassword }
elseif (-not (Test-Secret "admin-password")) { throw "First deploy: pass -AdminPassword so the /admin stats page has a password." }

if (-not (Test-Secret "stats-salt")) {
  $bytes = New-Object byte[] 24
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  Set-Secret "stats-salt" ([Convert]::ToBase64String($bytes))
}

$secrets = @("ADMIN_PASSWORD=admin-password:latest", "STATS_SALT=stats-salt:latest")
if ($SmtpPassword) { Set-Secret "smtp-password" $SmtpPassword }
if (Test-Secret "smtp-password") { $secrets += "SMTP_PASS=smtp-password:latest" }

$envVars = @("STORAGE=firestore", "FIRESTORE_COLLECTION=bookings")
if ($SheetId) { $envVars += "SHEET_ID=$SheetId", "SHEET_TAB=$SheetTab" }
if ($NotifyTo) { $envVars += "NOTIFY_TO=$NotifyTo" }
if ($NotifyFrom) { $envVars += "NOTIFY_FROM=$NotifyFrom" }
if ($SmtpHost) { $envVars += "SMTP_HOST=$SmtpHost", "SMTP_PORT=$SmtpPort" }
if ($SmtpUser) { $envVars += "SMTP_USER=$SmtpUser" }

Write-Host "==> Building and deploying to Cloud Run"
# --update-env-vars keeps values set by earlier deploys (e.g. SHEET_ID) when you omit them now.
gcloud run deploy $Service `
  --source . `
  --region $Region `
  --service-account $sa `
  --allow-unauthenticated `
  --update-env-vars ($envVars -join ",") `
  --update-secrets ($secrets -join ",") `
  --memory 256Mi `
  --cpu 1 `
  --min-instances 0 `
  --max-instances 3 `
  --concurrency 80 `
  --timeout 30

$url = gcloud run services describe $Service --region $Region --format="value(status.url)"
Write-Host ""
Write-Host "==> Done."
Write-Host "    Site:  $url"
Write-Host "    Stats: $url/admin   (log in with your admin password)"
if ($SheetId) { Write-Host "    Sheet: make sure it is shared with $sa as Editor." }
