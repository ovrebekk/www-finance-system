import { Link } from 'react-router';

export function NotFoundPage() {
  return (
    <section className="card">
      <h1>Page not found</h1>
      <Link to="/">Go to the dashboard</Link>
    </section>
  );
}
