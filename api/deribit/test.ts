export const config = { runtime: 'edge' };
export default async function handler() {
  return new Response('deribit-ok', { status: 200 });
}