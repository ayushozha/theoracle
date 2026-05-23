/**
 * The Oracle embeddable concierge widget — stub.
 *
 * Drop into any site with:
 *   <script src="https://the-oracle.app/embed.js" data-agent="concierge"></script>
 *
 * This file shows the intended public contract for the hackathon. The real
 * embed would inject an iframe pointing at /widget which hosts the same
 * <GeminiChat mode="floating" /> component, scoped to a per-site API token.
 */
(function () {
  if (window.__agentBazaarEmbedded) return;
  window.__agentBazaarEmbedded = true;

  var script = document.currentScript;
  var agent = (script && script.getAttribute('data-agent')) || 'concierge';
  var origin = 'https://the-oracle.app';

  var iframe = document.createElement('iframe');
  iframe.src = origin + '/widget?agent=' + encodeURIComponent(agent);
  iframe.title = 'The Oracle — ' + agent;
  iframe.allow = 'clipboard-write; microphone; camera';
  Object.assign(iframe.style, {
    position: 'fixed',
    bottom: '24px',
    right: '24px',
    width: '380px',
    height: '560px',
    border: '0',
    borderRadius: '22px',
    boxShadow: '0 24px 64px -20px rgba(15, 23, 42, 0.35)',
    zIndex: '2147483646',
    background: 'transparent',
  });

  function mount() {
    document.body.appendChild(iframe);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }
})();
