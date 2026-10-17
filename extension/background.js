// The content script can't talk to localhost under Dribbble's CSP, so every
// update is relayed through here, where the extension's own permissions apply.
const BASE = 'http://127.0.0.1:8899';

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || ['prospect', 'idle', 'present'].indexOf(msg.type) === -1) return;
  const url = msg.type === 'idle' ? BASE + '/idle'
            : msg.type === 'present' ? BASE + '/present'
            : BASE + '/active';
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(msg.payload || {})
  })
    .then(() => sendResponse({ ok: true }))
    .catch(() => sendResponse({ ok: false }));  // widget not running — stay quiet
  return true;  // keep the channel open for the async reply
});
