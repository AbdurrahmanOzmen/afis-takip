import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

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
    const adminClient = createClient(url, serviceKey, { auth: { persistSession: false } });
    const action = String(body.action || 'create');
    if (action === 'update') {
      const id = String(body.id || '');
      const displayName = String(body.display_name || '').trim();
      const role = body.role === 'admin' ? 'admin' : 'field';
      const team = String(body.team || '').trim();
      if (!id || !displayName) throw new Error('Kullanıcı kimliği ve ad soyad gereklidir.');
      if (id === user.id && role !== 'admin') throw new Error('Kendi yönetici yetkinizi kaldıramazsınız.');
      const updates: Record<string, unknown> = { email: body.email };
      if (typeof body.password === 'string' && body.password.length > 0) {
        if (body.password.length < 8) throw new Error('Şifre en az 8 karakter olmalıdır.');
        updates.password = body.password;
      }
      if (typeof body.email === 'string' && body.email.trim()) updates.email = body.email.trim().toLowerCase();
      const { error: authUpdateError } = await adminClient.auth.admin.updateUserById(id, updates);
      if (authUpdateError) throw authUpdateError;
      const { error: profileUpdateError } = await adminClient.from('profiles').update({ display_name: displayName, role, team: team || null }).eq('id', id);
      if (profileUpdateError) throw profileUpdateError;
      return new Response(JSON.stringify({ success: true }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    if (action === 'delete') {
      const id = String(body.id || '');
      if (!id) throw new Error('Kullanıcı kimliği gereklidir.');
      if (id === user.id) throw new Error('Kendi hesabınızı bu ekrandan silemezsiniz.');
      const { count, error: countError } = await adminClient.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'admin');
      if (countError) throw countError;
      const { data: targetProfile } = await adminClient.from('profiles').select('role').eq('id', id).maybeSingle();
      if (targetProfile?.role === 'admin' && (count || 0) <= 1) throw new Error('Son yönetici hesabı silinemez.');
      const { error: deleteError } = await adminClient.auth.admin.deleteUser(id);
      if (deleteError) throw deleteError;
      return new Response(JSON.stringify({ success: true }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    const displayName = String(body.display_name || '').trim();
    const role = body.role === 'admin' ? 'admin' : 'field';
    const team = String(body.team || '').trim();
    if (!email || !displayName || password.length < 8) throw new Error('E-posta, ad soyad ve en az 8 karakterli şifre gereklidir.');

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
