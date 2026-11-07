import { signal } from '../../../state.js';

export default function setup() {
  const [name, setName] = signal('');
  const [plan, setPlan] = signal('free');
  const [topic, setTopic] = signal('hello');
  const [seats, setSeats] = signal(1);
  const [agree, setAgree] = signal(false);
  const [error, setError] = signal('');
  const [sent, setSent] = signal(false);

  function submit(event) {
    event.preventDefault();
    if (!name().trim()) {
      setError('Name is required.');
      setSent(false);
      return;
    }
    if (!agree()) {
      setError('Agreement is required.');
      setSent(false);
      return;
    }
    if (seats() == null || seats() < 1) {
      setError('Seats must be at least 1.');
      setSent(false);
      return;
    }
    setError('');
    setSent(true);
  }

  return { name, setName, plan, setPlan, topic, setTopic, seats, setSeats, agree, setAgree, error, sent, submit };
}
