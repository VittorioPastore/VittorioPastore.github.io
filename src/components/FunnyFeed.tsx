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
        let mappedJokes: Joke[];
        const today = new Date().toISOString().split('T')[0];
        try {
          const response = await fetch(
            'https://v2.jokeapi.dev/joke/Programming,Pun?type=twopart&amount=5&safe-mode'
          );
          if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
          const data = await response.json();
          if (data.error || !Array.isArray(data.jokes)) throw new Error('Bad JokeAPI response');
          mappedJokes = data.jokes.map((joke: any) => ({
            id: joke.id,
            type: joke.category || 'general',
            setup: joke.setup || 'No setup available',
            punchline: joke.delivery || 'No punchline available',
            date: today,
          }));
        } catch {
          const response = await fetch('https://official-joke-api.appspot.com/jokes/ten');
          if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
          const jokesData = await response.json();
          mappedJokes = jokesData.map((joke: any) => ({
            id: joke.id,
            type: joke.type || 'general',
            setup: joke.setup || 'No setup available',
            punchline: joke.punchline || 'No punchline available',
            date: today,
          }));
        }
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
    <div className="card joke-feed">
      <p className="kicker">Laughs</p>
      {loading ? (
        <p className="meta">Loading...</p>
      ) : error ? (
        <p className="meta" style={{ color: 'var(--danger)' }}>{error}</p>
      ) : (
        <ul>
          {jokes.slice(0, 5).map(joke => (
            <li key={joke.id}>
              <p className="joke-setup">{joke.setup}</p>
              <p className="joke-punchline">{joke.punchline}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default JokeFeed;
