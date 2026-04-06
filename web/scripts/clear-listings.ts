import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  'https://vlzqdeisrngovqpbtsgi.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZsenFkZWlzcm5nb3ZxcGJ0c2dpIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDIxNzM4MCwiZXhwIjoyMDg5NzkzMzgwfQ.8o66f1NyyK03rnN1yRwxGJZZNjvfEj6Z5tIkX7Fbpvc'
)

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function clearListings() {
  console.log('Clearing listings table...')
  const { count: beforeCount } = await supabase
    .from('listings')
    .select('*', { count: 'exact', head: true })

  console.log(`Listings before: ${beforeCount}`)

  let deleted = 0
  const batchSize = 50

  // Keep deleting in batches until empty
  while (true) {
    const { data: ids } = await supabase
      .from('listings')
      .select('id')
      .limit(batchSize)

    if (!ids || ids.length === 0) break

    const idList = ids.map(row => (row as any).id)
    console.log(`Deleting batch of ${idList.length}...`)

    const { error } = await supabase
      .from('listings')
      .delete()
      .in('id', idList)

    if (error) {
      console.error('Error deleting batch:', error)
      // Don't exit, just keep trying
    } else {
      deleted += idList.length
      console.log(`Deleted so far: ${deleted}`)
    }

    // Wait between batches
    await sleep(2000)
  }

  const { count: afterCount } = await supabase
    .from('listings')
    .select('*', { count: 'exact', head: true })

  console.log(`Listings after: ${afterCount}`)
  console.log(`Total deleted: ${deleted}`)
}

clearListings().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
