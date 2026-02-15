window.SUPABASE_CONFIG = {
  url: 'https://aeumhaddvjltwxunzque.supabase.co',
  anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFldW1oYWRkdmpsdHd4dW56cXVlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA4NTQyMTgsImV4cCI6MjA4NjQzMDIxOH0.hHsmPoAp21gR3UCVM4EmwzftrFcMUmqaKsEl0PgfhLU'
};

const supabaseClient = supabase.createClient(
  window.SUPABASE_CONFIG.url,
  window.SUPABASE_CONFIG.anonKey
);

window.supabaseClient = supabaseClient;

window.TURNITO_CONFIG = {
  baseUrl: 'https://turnito.app/c/depilacionvectus'
  
};
