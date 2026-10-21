import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  try {
    const url = Deno.env.get('SUPABASE_URL');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !anonKey || !serviceKey) throw new Error('Supabase Edge Function ortam değişkenleri eksik.');
    const authHeader = req.headers.get('Authorization') || '';
    const userClient = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } });
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) return new Response(JSON.stringify({ error: 'Oturum doğrulanamadı.' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    const { data: profile, error: profileError } = await userClient.from('profiles').select('role').eq('id', user.id).single();
    if (profileError || profile?.role !== 'admin') return new Response(JSON.stringify({ error: 'Bu işlem için yönetici yetkisi gerekir.' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const body = await req.json();
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    const displayName = String(body.display_name || '').trim();
    const role = body.role === 'admin' ? 'admin' : 'field';
    const team = String(body.team || '').trim();
    if (!email || !displayName || password.length < 8) throw new Error('E-posta, ad soyad ve en az 8 karakterli şifre gereklidir.');

    const adminClient = createClient(url, serviceKey, { auth: { persistSession: false } });
    const { data: created, error: createError } = await adminClient.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { display_name: displayName } });
    if (createError) throw createError;
    const { error: insertError } = await adminClient.from('profiles').upsert({ id: created.user.id, display_name: displayName, role, team: team || null }, { onConflict: 'id' });
    if (insertError) {
      await adminClient.auth.admin.deleteUser(created.user.id);
      throw insertError;
    }
    return new Response(JSON.stringify({ id: created.user.id, email, display_name: displayName, role, team }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Kullanıcı oluşturulamadı.' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
