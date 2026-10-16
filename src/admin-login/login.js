(() => {
  const params = new URLSearchParams(location.search);
  const msg = {
    wrong: 'That password is not correct.',
    limit: 'Too many attempts. Please wait 15 minutes and try again.',
    expired: 'Your session ended. Please log in again.',
  }[params.get('error')];
  if (msg) document.getElementById('login-error').textContent = msg;
})();
