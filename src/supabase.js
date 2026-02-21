import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || "https://wvylxgthmadqprnbjlrc.supabase.co"
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind2eWx4Z3RobWFkcXBybmJqbHJjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE3MDk1MTksImV4cCI6MjA4NzI4NTUxOX0.ChwJG_8j2DDcOgtYV0KftGMXyfOMQhNuUcYwalsR46E"

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
