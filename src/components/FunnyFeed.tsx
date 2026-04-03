import React, { useEffect, useState } from 'react';

interface Joke {
  id: number;
  type: string;
  setup: string;
  punchline: string;
  date: string;
}

const JokeFeed = () => {
  const [jokes, setJokes] = useState<Joke[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchJokes = async () => {
      setLoading(true);
      setError(null);
      try {
        const cachedData = localStorage.getItem('jokes');
        const cachedTimestamp = localStorage.getItem('jokesTimestamp');
        const oneDay = 24 * 60 * 60 * 1000;
        if (cachedData && cachedTimestamp && Date.now() - Number(cachedTimestamp) < oneDay) {
          setJokes(JSON.parse(cachedData));
          setLoading(false);
          return;
        }
        const response = await fetch('https://official-joke-api.appspot.com/jokes/ten');
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const jokesData = await response.json();
        const mappedJokes: Joke[] = jokesData.map((joke: any) => ({
          id: joke.id,
          type: joke.type || 'general',
          setup: joke.setup || 'No setup available',
          punchline: joke.punchline || 'No punchline available',
          date: new Date().toISOString().split('T')[0],
        }));
        localStorage.setItem('jokes', JSON.stringify(mappedJokes));
        localStorage.setItem('jokesTimestamp', Date.now().toString());
        setJokes(mappedJokes);
      } catch (err: any) {
        setError('Failed to load jokes.');
      } finally {
        setLoading(false);
      }
    };
    fetchJokes();
  }, []);

  return (
    <div
      className="rounded-xl p-4 sm:p-6 h-full"
      style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)' }}
    >
      <p className="section-label mb-4">// laughs</p>
      {loading ? (
        <p style={{ color: 'var(--color-muted)', fontSize: '0.875rem' }}>Loading...</p>
      ) : error ? (
        <p style={{ color: '#ef4444', fontSize: '0.875rem' }}>{error}</p>
      ) : (
        <ul className="space-y-4">
          {jokes.slice(0, 5).map((joke, i) => (
            <li
              key={joke.id}
              style={i < 4 ? { borderBottom: '1px solid var(--border-subtle)', paddingBottom: '1rem' } : {}}
            >
              <p className="text-sm font-medium mb-1" style={{ color: 'var(--color-text)' }}>
                {joke.setup}
              </p>
              <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
                {joke.punchline}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default JokeFeed;
