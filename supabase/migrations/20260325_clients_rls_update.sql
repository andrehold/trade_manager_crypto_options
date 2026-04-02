-- Allow authenticated users to update and delete client records.
-- Admin-level access control is enforced at the application layer (isAdmin flag).

create policy "Authenticated users can update clients"
  on public.clients
  for update
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

create policy "Authenticated users can delete clients"
  on public.clients
  for delete
  using (auth.role() = 'authenticated');
