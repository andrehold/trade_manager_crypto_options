export const config = { runtime: 'edge' };
export default async function handler() {
  return new Response('ok', { status: 200 });
}