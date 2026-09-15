// Pure C0 model. No OS, clipboard, credential or UI integration.
export class QuickfillRequest {
  state = 'idle';
  capture(target, epoch, now, ttl = 5000) {
    if (this.state !== 'idle' || !target || ttl <= 0) throw new Error('invalid capture');
    this.target = structuredClone(target);
    this.epoch = epoch;
    this.deadline = now + ttl;
    this.state = 'captured';
  }
  select(field) {
    if (this.state !== 'captured' || !['user', 'password'].includes(field)) throw new Error('invalid selection');
    this.field = field;
    this.state = 'prepared';
  }
  cancel() { this.state = 'cancelled'; }
  verify(target, epoch, now, supported) {
    if (this.state !== 'prepared') return false;
    this.state = 'verifying';
    const same = ['processInstance', 'windowToken', 'focusToken'].every(k =>
      typeof target?.[k] === 'string' && target[k] === this.target[k]);
    this.state = supported && same && epoch === this.epoch && now < this.deadline ? 'executed' : 'cancelled';
    return this.state === 'executed'; // Mock outcome only, never sends input.
  }
}
