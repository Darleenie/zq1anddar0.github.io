let _resetToken = null;

document.addEventListener('DOMContentLoaded', async () => {
  const token = new URLSearchParams(window.location.search).get('token');

  if (!token) {
    show('rp-invalid');
    return;
  }

  // Validate token by attempting a dry-run — we just show the form if token looks present.
  // Real validation happens on submit; no separate validate endpoint needed.
  _resetToken = token;
  show('rp-form');
  setTimeout(() => document.getElementById('newPassword').focus(), 50);
});

async function submitReset() {
  const pw      = document.getElementById('newPassword').value;
  const confirm = document.getElementById('confirmPassword').value;
  const errEl   = document.getElementById('rp-error');
  errEl.style.display = 'none';

  if (pw.length < 6) {
    errEl.textContent = 'Password must be at least 6 characters.';
    errEl.style.display = '';
    return;
  }
  if (pw !== confirm) {
    errEl.textContent = 'Passwords do not match.';
    errEl.style.display = '';
    return;
  }

  try {
    const res = await fetch('/api/auth/reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: _resetToken, newPassword: pw }),
    });
    const data = await res.json();
    if (!res.ok) {
      if (res.status === 400) { show('rp-invalid'); return; }
      throw new Error(data.error || 'Failed');
    }
    show('rp-success');
  } catch (err) {
    errEl.textContent = err.message;
    errEl.style.display = '';
  }
}

function show(id) {
  ['rp-loading', 'rp-invalid', 'rp-form', 'rp-success'].forEach(s => {
    const el = document.getElementById(s);
    if (el) el.style.display = s === id ? '' : 'none';
  });
}
