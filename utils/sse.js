const setEventStreamHeaders = (res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  res.flushHeaders?.();
};

const writeEvent = (res, payload) => {
  if (res.writableEnded || res.destroyed) return;
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
};

module.exports = { setEventStreamHeaders, writeEvent };