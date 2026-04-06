import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  'https://vlzqdeisrngovqpbtsgi.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZsenFkZWlzcm5nb3ZxcGJ0c2dpIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDIxNzM4MCwiZXhwIjoyMDg5NzkzMzgwfQ.8o66f1NyyK03rnN1yRwxGJZZNjvfEj6Z5tIkX7Fbpvc'
)

async function sampleListings() {
  const { data, error } = await supabase
    .from('listings')
    .select('*')
    .limit(3)

  if (error) {
    console.error('Error:', error)
    process.exit(1)
  }

  console.log(`Found ${data?.length || 0} listings\n`)
  data?.slice(0, 3).forEach((listing: any, i: number) => {
    console.log(`[${i + 1}] Title: ${listing.title}`)
    console.log(`    Source: ${listing.source}`)
    console.log(`    Price: ${listing.price}`)
    console.log(`    Address: ${listing.address}`)
    console.log('')
  })
}

sampleListings()
