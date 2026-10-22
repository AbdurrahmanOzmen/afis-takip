import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
});

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Yalnızca POST desteklenir.' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const authorization = req.headers.get('Authorization') || '';
  if (!authorization.startsWith('Bearer ')) return json({ error: 'Oturum doğrulanamadı.' }, 401);

  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: callerData, error: callerError } = await callerClient.auth.getUser();
  if (callerError || !callerData.user) return json({ error: 'Oturum geçersiz veya süresi dolmuş.' }, 401);

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: callerProfile, error: profileError } = await admin
    .from('profiles').select('role').eq('id', callerData.user.id).maybeSingle();
  if (profileError || callerProfile?.role !== 'admin') return json({ error: 'Bu işlem yalnızca yöneticilere açıktır.' }, 403);

  try {
    const body = await req.json();
    const action = String(body.action || 'create');

    if (action === 'list') {
      const { data: profileRows, error: profilesError } = await admin
        .from('profiles').select('id,display_name,role,team').order('display_name');
      if (profilesError) throw profilesError;
      const authUsers: any[] = [];
      for (let page = 1; page <= 100; page++) {
        const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
        if (error) throw error;
        authUsers.push(...data.users);
        if (data.users.length < 1000) break;
      }
      const emailById = new Map(authUsers.map((u) => [u.id, u.email || '']));
      return json({ users: (profileRows || []).map((p) => ({ ...p, email: emailById.get(p.id) || '' })) });
    }

    if (action === 'create') {
      const display_name = String(body.display_name || '').trim();
      const email = String(body.email || '').trim().toLowerCase();
      const password = String(body.password || '');
      const role = body.role === 'admin' ? 'admin' : 'field';
      const team = String(body.team || '').trim();
      if (!display_name || !email || password.length < 8) return json({ error: 'Ad soyad, geçerli e-posta ve en az 8 karakterli şifre gereklidir.' }, 400);
      const { data: created, error: createError } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
      if (createError) throw createError;
      const { error: insertError } = await admin.from('profiles').upsert({ id: created.user.id, display_name, role, team }, { onConflict: 'id' });
      if (insertError) {
        await admin.auth.admin.deleteUser(created.user.id);
        throw insertError;
      }
      return json({ user: { id: created.user.id, display_name, email, role, team } });
    }

    if (action === 'update') {
      const id = String(body.id || '');
      const display_name = String(body.display_name || '').trim();
      const email = String(body.email || '').trim().toLowerCase();
      const role = body.role === 'admin' ? 'admin' : 'field';
      const team = String(body.team || '').trim();
      const password = String(body.password || '');
      if (!id || !display_name || !email) return json({ error: 'Kullanıcı, ad soyad ve e-posta zorunludur.' }, 400);
      if (password && password.length < 8) return json({ error: 'Şifre en az 8 karakter olmalıdır.' }, 400);
      if (id === callerData.user.id && role !== 'admin') return json({ error: 'Kendi yönetici yetkini bu ekrandan kaldıramazsın.' }, 400);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: 'Geçerli bir e-posta adresi gir.' }, 400);
      const { data: existingUserResult, error: existingUserError } = await admin.auth.admin.getUserById(id);
      if (existingUserError || !existingUserResult.user) return json({ error: 'Düzenlenecek kullanıcı hesabı bulunamadı.' }, 404);

      // E-posta yalnızca gerçekten değiştiyse güncellenir; yeni şifre de yalnızca doldurulmuşsa gönderilir.
      const authUpdates: Record<string, unknown> = {};
      if ((existingUserResult.user.email || '').toLowerCase() !== email) {
        authUpdates.email = email;
        authUpdates.email_confirm = true;
      }
      if (password) authUpdates.password = password;
      if (Object.keys(authUpdates).length) {
        const { error: authUpdateError } = await admin.auth.admin.updateUserById(id, authUpdates);
        if (authUpdateError) throw authUpdateError;
      }
      const { error: profileUpdateError } = await admin.from('profiles').update({ display_name, role, team }).eq('id', id);
      if (profileUpdateError) throw profileUpdateError;
      return json({ success: true, user: { id, display_name, email, role, team } });
    }

    if (action === 'delete') {
      const id = String(body.id || '');
      if (!id) return json({ error: 'Kullanıcı ID gereklidir.' }, 400);
      if (id === callerData.user.id) return json({ error: 'Kendi hesabını bu ekrandan silemezsin.' }, 400);
      const { error } = await admin.auth.admin.deleteUser(id);
      if (error) throw error;
      return json({ success: true });
    }

    return json({ error: 'Desteklenmeyen işlem.' }, 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Beklenmeyen bir hata oluştu.';
    return json({ error: message }, 400);
  }
});
