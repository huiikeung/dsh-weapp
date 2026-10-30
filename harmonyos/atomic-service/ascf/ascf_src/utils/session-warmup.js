function createSessionWarmup({ load, schedule = setTimeout, cancel = clearTimeout }) {
  let timer = null, generation = 0, signature = '';
  function stop() {
    generation += 1; signature = '';
    if (timer !== null) cancel(timer);
    timer = null;
  }
  function update(scope, sessions, ready) {
    const ids = [...new Set((sessions || []).map(s => s.sessionId || s.id).filter(Boolean))].slice(0, 4);
    const next = JSON.stringify([scope, ids]);
    if (!scope || !ready || !ids.length) { stop(); return; }
    if (signature === next) return;
    stop(); signature = next;
    const ticket = generation;
    const current = () => ticket === generation;
    function step() {
      timer = null;
      if (!current() || !ids.length) return;
      Promise.resolve().then(() => current() && load(ids.shift(), current)).catch(() => false).then(() => {
        if (current() && ids.length) timer = schedule(step, 100);
      });
    }
    timer = schedule(step, 750);
  }
  return { update, stop };
}
module.exports = { createSessionWarmup };
