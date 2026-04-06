import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  'https://vlzqdeisrngovqpbtsgi.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZsenFkZWlzcm5nb3ZxcGJ0c2dpIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDIxNzM4MCwiZXhwIjoyMDg5NzkzMzgwfQ.8o66f1NyyK03rnN1yRwxGJZZNjvfEj6Z5tIkX7Fbpvc'
)

async function checkCount() {
  const { count } = await supabase
    .from('listings')
    .select('*', { count: 'exact', head: true })
  console.log(`Current listing count: ${count}`)
}

checkCount()
