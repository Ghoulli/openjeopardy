// Central config — edit here to change server connection or other constants.

// Use WSS when the page is served over HTTPS (required for internet-facing deployments).
// When running the Vite dev server (:5173), talk directly to the backend on :3001.
// In production, the server serves the client at its own origin, so use that.
const wsProto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const isViteDev = ['5173', '5174'].includes(window.location.port);
export const WS_URL = isViteDev
  ? `${wsProto}//${window.location.hostname}:3001`
  : `${wsProto}//${window.location.host}`;

export const MAX_NAME_LEN = 50;
