// Structured JSON logs; Cloud Logging picks up "severity" and "message" automatically.
function write(severity, message, fields = {}) {
  const line = JSON.stringify({ severity, message, ...fields, time: new Date().toISOString() });
  if (severity === 'ERROR' || severity === 'WARNING') console.error(line);
  else console.log(line);
}

export const log = {
  info: (msg, fields) => write('INFO', msg, fields),
  warn: (msg, fields) => write('WARNING', msg, fields),
  error: (msg, fields) => write('ERROR', msg, fields),
};
