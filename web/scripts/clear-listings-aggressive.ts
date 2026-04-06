import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  'https://vlzqdeisrngovqpbtsgi.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZsenFkZWlzcm5nb3ZxcGJ0c2dpIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDIxNzM4MCwiZXhwIjoyMDg5NzkzMzgwfQ.8o66f1NyyK03rnN1yRwxGJZZNjvfEj6Z5tIkX7Fbpvc'
)

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function clearListings() {
  console.log('Aggressive clearing with 30-batch size...')
  
  let deleted = 0
  const batchSize = 30

  // Keep deleting in batches until empty
  while (true) {
    const { data: ids } = await supabase
      .from('listings')
      .select('id')
      .limit(batchSize)

    if (!ids || ids.length === 0) {
      console.log('All listings cleared!')
      break
    }

    const idList = ids.map(row => (row as any).id)

    const { error } = await supabase
      .from('listings')
      .delete()
      .in('id', idList)

    if (!error) {
      deleted += idList.length
      if (deleted % 300 === 0) {
        console.log(`Deleted: ${deleted}`)
      }
    }

    // Shorter wait
    await sleep(500)
  }

  const { count: afterCount } = await supabase
    .from('listings')
    .select('*', { count: 'exact', head: true })

  console.log(`Final count: ${afterCount}`)
  console.log(`Total deleted in this pass: ${deleted}`)
}

clearListings().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
