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
        // Check for cached data that’s less than a day old.
        const cachedData = localStorage.getItem('jokes');
        const cachedTimestamp = localStorage.getItem('jokesTimestamp');
        const oneDay = 24 * 60 * 60 * 1000;

        if (cachedData && cachedTimestamp && Date.now() - Number(cachedTimestamp) < oneDay) {
          setJokes(JSON.parse(cachedData));
          setLoading(false);
          return;
        }

        // Official Joke API returns an array of 10 jokes.
        const response = await fetch("https://official-joke-api.appspot.com/jokes/ten");
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        const jokesData = await response.json();

        // Map the data to our Joke interface.
        const mappedJokes: Joke[] = jokesData.map((joke: any) => ({
          id: joke.id,
          type: joke.type || "general",
          setup: joke.setup || "No setup available",
          punchline: joke.punchline || "No punchline available",
          date: new Date().toISOString().split("T")[0] // Formats the current date (YYYY-MM-DD)
        }));

        // Save the fetched data and timestamp to localStorage.
        localStorage.setItem('jokes', JSON.stringify(mappedJokes));
        localStorage.setItem('jokesTimestamp', Date.now().toString());

        setJokes(mappedJokes);
      } catch (err: any) {
        console.error("Failed to fetch jokes:", err);
        setError("Failed to load jokes. Please try again later.");
      } finally {
        setLoading(false);
      }
    };

    fetchJokes();
  }, []);

  return (
    <div className="glass p-6 rounded-3xl">
      <h3 className="text-2xl font-bold mb-4 text-gradient">Recent Laughs</h3>
      {loading ? (
        <p className="text-gray-200">Loading jokes...</p>
      ) : error ? (
        <p className="text-red-400">{error}</p>
      ) : jokes.length > 0 ? (
        <ul className="space-y-4">
          {jokes.slice(0, 5).map((joke) => (
            <li key={joke.id} className="text-gray-200">
              <p className="font-semibold">{joke.setup}</p>
              <p className="text-sm text-gray-400">{joke.punchline}</p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-gray-200">No jokes available.</p>
      )}
    </div>
  );
};

export default JokeFeed;
