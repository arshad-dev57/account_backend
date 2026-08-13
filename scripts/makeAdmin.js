const prisma = require('../prisma/client');

async function makeUserAdmin() {
  try {
    console.log('═══════════════════════════════════════════════════');
    console.log('🔍 Fetching all users...');
    
    const users = await prisma.user.findMany({
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        role: true,
        createdAt: true
      },
      orderBy: { createdAt: 'asc' }
    });

    console.log(`📊 Found ${users.length} users:`);
    users.forEach((user, index) => {
      console.log(`   ${index + 1}. ${user.firstName} ${user.lastName} (${user.email}) - Role: ${user.role}`);
    });

    console.log('═══════════════════════════════════════════════════');
    
    // Update the first user to admin
    if (users.length > 0) {
      const firstUser = users[0];
      console.log(`👑 Updating ${firstUser.email} to admin role...`);
      
      const updated = await prisma.user.update({
        where: { id: firstUser.id },
        data: { role: 'admin' },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          role: true
        }
      });

      console.log('✅ User updated successfully:');
      console.log(`   - Name: ${updated.firstName} ${updated.lastName}`);
      console.log(`   - Email: ${updated.email}`);
      console.log(`   - Role: ${updated.role}`);
    } else {
      console.log('❌ No users found in database');
    }

    console.log('═══════════════════════════════════════════════════');
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

makeUserAdmin();
