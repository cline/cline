// Simple test to verify database functionality
import { getDatabase } from './client';
import { upsertSystemPrompt, createBenchmarkRun, getDatabaseSummary } from './index';

async function testDatabase() {
  console.log('Testing database functionality...');
  
  try {
    // Test database connection
    const db = getDatabase();
    console.log('✓ Database connection established');
    console.log('Database path:', db.getDatabasePath());
    
    // Test database info
    const info = db.getInfo();
    console.log('✓ Database info:', info);
    
    // Test database stats
    const stats = db.getStats();
    console.log('✓ Database stats:', stats);
    
    // Test system prompt creation
    const systemPromptHash = await upsertSystemPrompt({
      name: 'test-prompt',
      content: 'This is a test system prompt for database verification.'
    });
    console.log('✓ System prompt created with hash:', systemPromptHash);
    
    // Test benchmark run creation
    const runId = await createBenchmarkRun({
      description: 'Test run for database verification',
      system_prompt_hash: systemPromptHash
    });
    console.log('✓ Benchmark run created with ID:', runId);
    
    // Test database summary
    const summary = await getDatabaseSummary();
    console.log('✓ Database summary:', summary);
    
    console.log('\n🎉 All database tests passed!');
    
  } catch (error) {
    console.error('❌ Database test failed:', error);
    process.exit(1);
  }
}

// Run test if this file is executed directly
if (require.main === module) {
  testDatabase();
}

export { testDatabase };
