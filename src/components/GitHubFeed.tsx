import { useState, useEffect } from 'react';
import { Octokit } from 'octokit';

interface GitHubEvent {
  id: string;
  type: string;
  repo: {
    name: string;
  };
  created_at: string;
  payload: any;
}

export default function GitHubFeed() {
  const [events, setEvents] = useState<GitHubEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchGitHubActivity = async () => {
      try {
        const octokit = new Octokit();
        const response = await octokit.request('GET /users/{username}/events/public', {
          username: 'VittorioPastore', 
          per_page: 5
        });
        setEvents(response.data);
      } catch (err) {
        setError('Failed to fetch GitHub activity');
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    fetchGitHubActivity();
  }, []);

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  if (loading) return <div className="text-center py-8">Loading GitHub activity...</div>;
  if (error) return <div className="text-center text-red-500 py-8">{error}</div>;

  return (
    <div className="glass p-6 rounded-xl">
      <h3 className="text-2xl font-bold mb-4 text-gradient">Recent Github Activity</h3>
      <div className="space-y-4">
        {events.map((event) => (
          <div key={event.id} className="border-b border-white/10 pb-4 last:border-0">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm text-white/90">
                  {event.type.replace('Event', '')} on {event.repo.name}
                </p>
                <p className="text-xs text-white/60">{formatDate(event.created_at)}</p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}