// db/tests/realtime_check.mjs
// Realtime subscription check for DB-07 (SIH26121)
// Subscribes to postgres_changes on public.alerts and prints incoming events for 60 seconds.

/*
  =============================================================================
  Realtime Verification Instructions:
  =============================================================================
  1. Prerequisites:
     Ensure @supabase/supabase-js is installed:
       cd apps/web && npm install
     (or run `npm install @supabase/supabase-js` in root / db)

  2. Run this check:
     node --env-file=.env db/tests/realtime_check.mjs
     
     Alternatively, supply credentials directly:
     $env:TEST_EMAIL="admin@example.com"; $env:TEST_PASSWORD="password"; node db/tests/realtime_check.mjs

  3. Trigger a test event from the Supabase SQL Editor while this script is listening:
     -------------------------------------------------------------------------
     insert into public.alerts (
       wellbore_id,
       kind,
       severity,
       state,
       dedup_key,
       title,
       message
     ) values (
       (select id from public.wellbores limit 1),
       'lookahead',
       'warning',
       'sent',
       'realtime-test-' || gen_random_uuid(),
       'Realtime Verification Alert',
       'Testing live CDC push to subscriber via supabase_realtime'
     );
     -------------------------------------------------------------------------

  4. Acceptance:
     - The script receives and prints the INSERT event within < 2 seconds.
     - Automatically disconnects and exits after 60 seconds.
  =============================================================================
*/

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Helper to resolve @supabase/supabase-js from local or apps/web node_modules
let createClient;
try {
  const supabaseModule = await import('@supabase/supabase-js');
  createClient = supabaseModule.createClient;
} catch {
  try {
    const localWebPath = path.resolve('apps/web/node_modules/@supabase/supabase-js/dist/index.mjs');
    const supabaseModule = await import(pathToFileURL(localWebPath).href);
    createClient = supabaseModule.createClient;
  } catch (err) {
    console.error('ERROR: Could not resolve @supabase/supabase-js:', err.message);
    console.error('Please run "npm install" inside apps/web or root before running this script.');
    process.exit(1);
  }
}

// 1. Read environment variables from process.env or .env file
function loadEnv() {
  const envPath = path.resolve('.env');
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, 'utf-8');
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx > 0) {
        const key = trimmed.slice(0, eqIdx).trim();
        const val = trimmed.slice(eqIdx + 1).trim();
        if (!process.env[key]) {
          process.env[key] = val;
        }
      }
    }
  }
}

loadEnv();

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
const testEmail = process.env.TEST_EMAIL;
const testPassword = process.env.TEST_PASSWORD;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('ERROR: Missing SUPABASE_URL or VITE_SUPABASE_ANON_KEY in environment or .env');
  process.exit(1);
}

console.log('--- NWIS Realtime Check (DB-07) ---');
console.log(`Connecting to: ${supabaseUrl}`);

const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  realtime: {
    params: {
      eventsPerSecond: 10,
    },
  },
});

// 2. Authenticate if test credentials provided
if (testEmail && testPassword) {
  console.log(`Signing in as test user: ${testEmail}...`);
  const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
    email: testEmail,
    password: testPassword,
  });

  if (authError) {
    console.warn(`Sign-in warning: ${authError.message}. Proceeding with anon connection.`);
  } else {
    console.log(`Successfully signed in. User ID: ${authData.user.id}`);
  }
} else {
  console.log('No TEST_EMAIL/TEST_PASSWORD provided. Running as unauthenticated/anon subscriber.');
}

// 3. Subscribe to postgres_changes on public.alerts
let eventCount = 0;

const channel = supabase
  .channel('realtime-alerts-check')
  .on(
    'postgres_changes',
    {
      event: '*',
      schema: 'public',
      table: 'alerts',
    },
    (payload) => {
      eventCount++;
      console.log('\n========================================');
      console.log(`[ALERT EVENT #${eventCount}] ${payload.eventType} at ${new Date().toISOString()}`);
      console.log('Payload details:');
      console.log(JSON.stringify(payload, null, 2));
      console.log('========================================\n');
    }
  )
  .subscribe((status, err) => {
    if (status === 'SUBSCRIBED') {
      console.log('\n[STATUS: SUBSCRIBED] Successfully connected to realtime channel.');
      console.log('Listening for changes on table "public.alerts" for 60 seconds...');
      console.log('Tip: Run an INSERT statement in the Supabase SQL editor to see events appear live here.\n');
    } else if (status === 'CHANNEL_ERROR') {
      console.error('[STATUS: CHANNEL_ERROR] Channel error occurred:', err);
    } else if (status === 'TIMED_OUT') {
      console.error('[STATUS: TIMED_OUT] Realtime connection timed out.');
    } else {
      console.log(`[STATUS: ${status}]`);
    }
  });

// 4. Timer to exit after 60 seconds
const DURATION_SECONDS = 60;
setTimeout(async () => {
  console.log(`\n${DURATION_SECONDS} seconds completed. Total alert events received: ${eventCount}.`);
  console.log('Unsubscribing channel and exiting...');
  await supabase.removeChannel(channel);
  process.exit(0);
}, DURATION_SECONDS * 1000);
