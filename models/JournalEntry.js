// models/JournalEntry.js - Prisma Helper Version
const prisma = require('../prisma/client');

class JournalEntryModel {
  // ============================================================
  // CREATE JOURNAL ENTRY
  // ============================================================
  static async create(data) {
    // Generate entry number
    const count = await prisma.journalEntry.count();
    const year = new Date().getFullYear();
    const entryNumber = `JE-${year}-${String(count + 1).padStart(4, '0')}`;

    // Validate debit = credit
    let totalDebit = 0;
    let totalCredit = 0;
    data.lines.forEach(line => {
      totalDebit += line.debit || 0;
      totalCredit += line.credit || 0;
    });

    if (Math.abs(totalDebit - totalCredit) > 0.01) {
      throw new Error('Total Debit must equal Total Credit');
    }

    return await prisma.journalEntry.create({
      data: {
        entryNumber,
        date: data.date || new Date(),
        description: data.description,
        reference: data.reference || '',
        status: data.status || 'Draft',
        createdBy: data.createdBy,
        lines: {
          create: data.lines.map(line => ({
            accountId: line.accountId,
            accountName: line.accountName,
            accountCode: line.accountCode,
            debit: line.debit || 0,
            credit: line.credit || 0,
            isReconciled: line.isReconciled || false,
          }))
        }
      },
      include: {
        creator: {
          select: { id: true, firstName: true, lastName: true, email: true }
        },
        lines: {
          include: {
            account: {
              select: { id: true, code: true, name: true, type: true }
            }
          }
        }
      }
    });
  }

  // ============================================================
  // GET ALL JOURNAL ENTRIES
  // ============================================================
  static async findAll(filter = {}, options = {}) {
    const { skip, take, orderBy = { date: 'desc' } } = options;
    
    return await prisma.journalEntry.findMany({
      where: filter,
      skip,
      take,
      orderBy,
      include: {
        creator: {
          select: { id: true, firstName: true, lastName: true, email: true }
        },
        poster: {
          select: { id: true, firstName: true, lastName: true, email: true }
        },
        lines: {
          include: {
            account: {
              select: { id: true, code: true, name: true, type: true }
            }
          }
        }
      }
    });
  }

  // ============================================================
  // COUNT JOURNAL ENTRIES
  // ============================================================
  static async count(filter = {}) {
    return await prisma.journalEntry.count({ where: filter });
  }

  // ============================================================
  // FIND BY ID
  // ============================================================
  static async findById(id) {
    return await prisma.journalEntry.findUnique({
      where: { id },
      include: {
        creator: {
          select: { id: true, firstName: true, lastName: true, email: true }
        },
        poster: {
          select: { id: true, firstName: true, lastName: true, email: true }
        },
        lines: {
          include: {
            account: {
              select: { id: true, code: true, name: true, type: true }
            }
          }
        }
      }
    });
  }

  // ============================================================
  // FIND BY ENTRY NUMBER
  // ============================================================
  static async findByEntryNumber(entryNumber) {
    return await prisma.journalEntry.findUnique({
      where: { entryNumber },
      include: {
        creator: {
          select: { id: true, firstName: true, lastName: true, email: true }
        },
        lines: {
          include: {
            account: {
              select: { id: true, code: true, name: true, type: true }
            }
          }
        }
      }
    });
  }

  // ============================================================
  // UPDATE JOURNAL ENTRY
  // ============================================================
  static async update(id, data) {
    // If lines are being updated, validate debit = credit
    if (data.lines && data.lines.length > 0) {
      let totalDebit = 0;
      let totalCredit = 0;
      data.lines.forEach(line => {
        totalDebit += line.debit || 0;
        totalCredit += line.credit || 0;
      });

      if (Math.abs(totalDebit - totalCredit) > 0.01) {
        throw new Error('Total Debit must equal Total Credit');
      }

      // Delete old lines
      await prisma.journalLine.deleteMany({
        where: { journalId: id }
      });

      // Update with new lines
      return await prisma.journalEntry.update({
        where: { id },
        data: {
          date: data.date,
          description: data.description,
          reference: data.reference,
          status: data.status,
          lines: {
            create: data.lines.map(line => ({
              accountId: line.accountId,
              accountName: line.accountName,
              accountCode: line.accountCode,
              debit: line.debit || 0,
              credit: line.credit || 0,
              isReconciled: line.isReconciled || false,
            }))
          }
        },
        include: {
          creator: {
            select: { id: true, firstName: true, lastName: true, email: true }
          },
          lines: {
            include: {
              account: {
                select: { id: true, code: true, name: true, type: true }
              }
            }
          }
        }
      });
    }

    // Update without changing lines
    return await prisma.journalEntry.update({
      where: { id },
      data: {
        date: data.date,
        description: data.description,
        reference: data.reference,
        status: data.status,
        postedBy: data.postedBy,
        postedAt: data.postedAt
      },
      include: {
        creator: {
          select: { id: true, firstName: true, lastName: true, email: true }
        },
        lines: {
          include: {
            account: {
              select: { id: true, code: true, name: true, type: true }
            }
          }
        }
      }
    });
  }

  // ============================================================
  // POST JOURNAL ENTRY
  // ============================================================
  static async post(id, userId) {
    return await prisma.journalEntry.update({
      where: { id },
      data: {
        status: 'Posted',
        postedBy: userId,
        postedAt: new Date()
      },
      include: {
        creator: {
          select: { id: true, firstName: true, lastName: true, email: true }
        },
        poster: {
          select: { id: true, firstName: true, lastName: true, email: true }
        },
        lines: {
          include: {
            account: {
              select: { id: true, code: true, name: true, type: true }
            }
          }
        }
      }
    });
  }

  // ============================================================
  // DELETE JOURNAL ENTRY
  // ============================================================
  static async delete(id) {
    // Delete lines first
    await prisma.journalLine.deleteMany({
      where: { journalId: id }
    });
    
    // Delete entry
    return await prisma.journalEntry.delete({
      where: { id }
    });
  }

  // ============================================================
  // GET JOURNAL ENTRY STATS
  // ============================================================
  static async getStats(userId) {
    const [total, posted, draft] = await Promise.all([
      prisma.journalEntry.count({ where: { createdBy: userId } }),
      prisma.journalEntry.count({ where: { createdBy: userId, status: 'Posted' } }),
      prisma.journalEntry.count({ where: { createdBy: userId, status: 'Draft' } })
    ]);

    const financial = await prisma.journalLine.aggregate({
      where: {
        journal: {
          createdBy: userId
        }
      },
      _sum: {
        debit: true,
        credit: true
      }
    });

    return {
      total,
      posted,
      draft,
      totalDebit: financial._sum.debit || 0,
      totalCredit: financial._sum.credit || 0
    };
  }

  // ============================================================
  // SEARCH JOURNAL ENTRIES
  // ============================================================
  static async search(query, userId, options = {}) {
    const { skip, take } = options;

    const filter = {
      createdBy: userId,
      OR: [
        { entryNumber: { contains: query, mode: 'insensitive' } },
        { description: { contains: query, mode: 'insensitive' } },
        { reference: { contains: query, mode: 'insensitive' } }
      ]
    };

    const entries = await prisma.journalEntry.findMany({
      where: filter,
      skip,
      take,
      orderBy: { date: 'desc' },
      include: {
        creator: {
          select: { id: true, firstName: true, lastName: true, email: true }
        },
        lines: {
          include: {
            account: {
              select: { id: true, code: true, name: true, type: true }
            }
          }
        }
      }
    });

    const total = await prisma.journalEntry.count({ where: filter });

    return { entries, total };
  }

  // ============================================================
  // GET ENTRIES BY DATE RANGE
  // ============================================================
  static async getByDateRange(userId, startDate, endDate) {
    return await prisma.journalEntry.findMany({
      where: {
        createdBy: userId,
        date: {
          gte: new Date(startDate),
          lte: new Date(endDate)
        }
      },
      orderBy: { date: 'asc' },
      include: {
        lines: {
          include: {
            account: {
              select: { id: true, code: true, name: true, type: true }
            }
          }
        }
      }
    });
  }

  // ============================================================
  // GET ENTRIES BY ACCOUNT
  // ============================================================
  static async getByAccount(userId, accountId) {
    return await prisma.journalEntry.findMany({
      where: {
        createdBy: userId,
        lines: {
          some: {
            accountId
          }
        }
      },
      orderBy: { date: 'desc' },
      include: {
        lines: {
          include: {
            account: {
              select: { id: true, code: true, name: true, type: true }
            }
          }
        }
      }
    });
  }
}

module.exports = JournalEntryModel;