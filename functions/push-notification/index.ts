import webpush from 'npm:web-push@3.6.7';
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-push-webhook-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });

  const expectedSecret = Deno.env.get('PUSH_WEBHOOK_SECRET');
  if (!expectedSecret || req.headers.get('x-push-webhook-secret') !== expectedSecret) {
    return new Response('Unauthorized', { status: 401, headers: corsHeaders });
  }

  try {
    const payload = await req.json();
    const record = payload?.record;
    if (payload?.type !== 'INSERT' || payload?.table !== 'notifications' || !record?.user_id) {
      return Response.json({ ok: true, skipped: true }, { headers: corsHeaders });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const publicKey = Deno.env.get('VAPID_PUBLIC_KEY');
    const privateKey = Deno.env.get('VAPID_PRIVATE_KEY');
    const subject = Deno.env.get('VAPID_SUBJECT') || 'mailto:admin@example.com';
    if (!supabaseUrl || !serviceRoleKey || !publicKey || !privateKey) {
      throw new Error('Push function secrets are incomplete.');
    }

    webpush.setVapidDetails(subject, publicKey, privateKey);
    const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: subscriptions, error } = await supabase
      .from('push_subscriptions')
      .select('endpoint, subscription')
      .eq('user_id', record.user_id);
    if (error) throw error;

    const message = JSON.stringify({
      id: record.id,
      title: record.title || 'Algida Afiş Takip',
      body: record.body || 'Yeni bir bildirimin var.',
      url: './'
    });

    let sent = 0;
    let removed = 0;
    for (const item of subscriptions || []) {
      try {
        await webpush.sendNotification(item.subscription, message, { TTL: 60 * 60 });
        sent++;
      } catch (pushError) {
        const statusCode = Number((pushError as { statusCode?: number })?.statusCode || 0);
        if (statusCode === 404 || statusCode === 410) {
          await supabase.from('push_subscriptions').delete().eq('endpoint', item.endpoint);
          removed++;
        } else {
          console.error('Web Push delivery failed:', statusCode, pushError);
        }
      }
    }

    return Response.json({ ok: true, sent, removed }, { headers: corsHeaders });
  } catch (error) {
    console.error('push-notification error:', error);
    return Response.json({ ok: false, error: error instanceof Error ? error.message : 'Unexpected error' }, { status: 500, headers: corsHeaders });
  }
});
