// Mock MITRE ATT&CK coverage data for the ATT&CK view.
// hits = 0 means the technique hasn't been observed in the current scenario.
 
export const tactics = [
  {
    name: "Reconnaissance",
    techniques: [
      { id: "T1595", name: "Active Scanning", hits: 12 },
      { id: "T1589", name: "Gather Victim Identity", hits: 0 },
    ],
  },
  {
    name: "Initial Access",
    techniques: [
      { id: "T1190", name: "Exploit Public-Facing App", hits: 46 },
      { id: "T1078", name: "Valid Accounts", hits: 8 },
      { id: "T1133", name: "External Remote Services", hits: 0 },
    ],
  },
  {
    name: "Execution",
    techniques: [
      { id: "T1609", name: "Command & Scripting Interp", hits: 34 },
      { id: "T1610", name: "Container Admin Command", hits: 6 },
      { id: "T1203", name: "Exploitation for Client Exec", hits: 0 },
    ],
  },
  {
    name: "Persistence",
    techniques: [
      { id: "T1543", name: "Create/Modify Sys Process", hits: 2 },
      { id: "T1136", name: "Create Account", hits: 0 },
      { id: "T1505", name: "Server Software Component", hits: 0 },
    ],
  },
  {
    name: "Privilege Escalation",
    techniques: [
      { id: "T1611", name: "Escape to Host", hits: 12 },
      { id: "T1548", name: "Abuse Elevation Control", hits: 2 },
      { id: "T1068", name: "Exploit for Priv Esc", hits: 0 },
    ],
  },
  {
    name: "Defense Evasion",
    techniques: [
      { id: "T1070", name: "Indicator Removal", hits: 0 },
      { id: "T1562", name: "Impair Defenses", hits: 0 },
      { id: "T1211", name: "Exploit for Def Evasion", hits: 0 },
    ],
  },
  {
    name: "Credential Access",
    techniques: [
      { id: "T1552", name: "Unsecured Credentials", hits: 22 },
      { id: "T1110", name: "Brute Force", hits: 9 },
      { id: "T1555", name: "Creds from Password Stores", hits: 0 },
    ],
  },
  {
    name: "Discovery",
    techniques: [
      { id: "T1083", name: "File & Directory Discovery", hits: 7 },
      { id: "T1046", name: "Network Service Discovery", hits: 4 },
      { id: "T1033", name: "System Owner Discovery", hits: 0 },
    ],
  },
  {
    name: "Lateral Movement",
    techniques: [
      { id: "T1210", name: "Exploit of Remote Services", hits: 1 },
      { id: "T1021", name: "Remote Services", hits: 0 },
    ],
  },
  {
    name: "Collection",
    techniques: [
      { id: "T1560", name: "Archive Collected Data", hits: 0 },
      { id: "T1005", name: "Data from Local System", hits: 2 },
    ],
  },
  {
    name: "Command & Control",
    techniques: [
      { id: "T1071", name: "Application Layer Protocol", hits: 9 },
      { id: "T1571", name: "Non-Standard Port", hits: 8 },
      { id: "T1090", name: "Proxy", hits: 0 },
    ],
  },
  {
    name: "Exfiltration",
    techniques: [
      { id: "T1041", name: "Exfil Over C2 Channel", hits: 1 },
      { id: "T1048", name: "Exfil Over Alt Protocol", hits: 0 },
    ],
  },
  {
    name: "Impact",
    techniques: [
      { id: "T1499", name: "Endpoint DoS", hits: 0 },
      { id: "T1496", name: "Resource Hijacking", hits: 0 },
    ],
  },
];
 
export const totalTechniques = tactics.reduce((sum, t) => sum + t.techniques.length, 0);
export const detectedTechniques = tactics.reduce(
  (sum, t) => sum + t.techniques.filter((tech) => tech.hits > 0).length,
  0
);
 
export const matchedLogsByTechnique = {
  T1609: [
    { time: "14:32:19", source: "Falco", title: "Terminal shell in container", detail: "proc=sh ppid=node container=juice-shop-7d9f" },
    { time: "13:08:49", source: "Falco", title: "Shell spawned by web process", detail: "proc=bash ppid=node" },
    { time: "12:26:39", source: "Falco", title: "Suspicious interpreter launch", detail: "proc=python -c" },
  ],
  T1190: [
    { time: "14:32:07", source: "WAS", title: "SQL Injection in query param", detail: "GET /rest/products/search?q=') UNION SELECT ... · HTTP 403" },
  ],
  T1552: [
    { time: "14:32:15", source: "Falco", title: "Read sensitive file untrusted", detail: "fd.name=/etc/shadow proc=sh" },
  ],
  T1611: [
    { time: "12:21:11", source: "K8s Audit", title: "Privileged container created", detail: "user=dev-sa verb=create resource=pods" },
  ],
  T1071: [
    { time: "14:32:19", source: "Falco", title: "Unexpected outbound connection", detail: "proto=tcp dst=185.220.101.4:9001 (Tor exit)" },
  ],
};