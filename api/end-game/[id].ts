export const config = { runtime: 'edge' };

const VM_ORIGIN = 'https://34.44.229.168.sslip.io:3000';

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response('method not allowed', { status: 405 });
  }
  const id = new URL(req.url).pathname.split('/').pop();
  if (!id || !/^\d+$/.test(id)) {
    return new Response(JSON.stringify({ error: 'invalid id' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  try {
    const body = await req.text();
    const upstream = await fetch(`${VM_ORIGIN}/api/end-game/${id}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Game-Secret': process.env['GAME_API_SECRET'] ?? '',
      },
      body,
    });
    const data = await upstream.text();
    return new Response(data, {
      status: upstream.status,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch {
    return new Response(JSON.stringify({ error: 'unavailable' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
