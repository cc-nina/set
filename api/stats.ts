export const config = { runtime: 'edge' };

const UPSTREAM = 'https://34.44.229.168.sslip.io:3000/api/stats';

export default async function handler(): Promise<Response> {
  try {
    const upstream = await fetch(UPSTREAM);
    if (!upstream.ok) {
      return new Response(JSON.stringify({ error: 'stats unavailable' }), {
        status: upstream.status,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    const data = await upstream.text();
    return new Response(data, {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 's-maxage=15, stale-while-revalidate=150',
      },
    });
  } catch {
    return new Response(JSON.stringify({ error: 'stats unavailable' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
