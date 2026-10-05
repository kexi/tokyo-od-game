import { installDiagnostics } from "./diagnostics";

// The page's first script (index.html): the seed, the failure handlers and the log shipping are in
// place before boot.ts and main.ts run anything.
installDiagnostics();
