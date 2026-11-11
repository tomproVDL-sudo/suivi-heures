// Configuration. La clé "anon" est publique par conception : la sécurité repose
// sur les règles RLS de Supabase (voir supabase/securite_rls.sql).
export const SUPABASE_URL = 'https://rxqtsguwoqeojsnaagxb.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ4cXRzZ3V3b3Flb2pzbmFhZ3hiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODcxNTA4MjcsImV4cCI6MjEwMjcyNjgyN30.FTPTGSe6tqDTieqQdD-GWUqueKlEPUpw4QGiMa4U8AA';

export const APP_VERSION = '2.0.3';

// Bibliothèques lourdes chargées uniquement à la demande (export / import).
export const CDN = {
  xlsx: 'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js',
  jspdf: 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
};

// Sauvegardes automatiques
export const BACKUP = {
  localEveryHours: 24, // un instantané local par jour
  localKeep: 14, // on garde les 14 derniers
  cloudEveryDays: 7, // un instantané cloud par semaine
  cloudKeep: 12, // on garde les 12 derniers automatiques
};
