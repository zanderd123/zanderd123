// Settings for the installed app (quotient/app). build.mjs copies this file there.
//
// Fill in both values from your Supabase project (Dashboard → Project Settings → API)
// to switch on Friends. The anon key is meant to be public: what each person can
// read or write is enforced by the database's row-level security rules.
// Never put the service_role key here.
window.QUOTIENT_CONFIG = {
  supabaseUrl: '',      // e.g. 'https://abcdefghijklmnop.supabase.co'
  supabaseAnonKey: '',  // the "anon public" key
};
