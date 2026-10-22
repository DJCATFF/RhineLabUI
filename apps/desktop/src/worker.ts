process.parentPort.postMessage({
  ok: true,
  pid: process.pid,
  node: process.versions.node,
  electron: process.versions.electron,
  cwd: process.cwd(),
  now: new Date().toISOString(),
});
