/**
 * tests/referralService.test.js
 * Comprehensive unit tests for multi-level referral tree system
 */

const {
  registerReferral,
  processMultiLevelPayout,
  getReferralStats,
  getReferralTree,
} = require('./referralService');
const pool = require('../db/pool');

// Mock the database pool
jest.mock('../db/pool');

// Valid Stellar test addresses (56 chars, starting with G)
const ADDR_ALICE = "GALICE1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ123456789ABCDE";
const ADDR_BOB = "GBOB1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ123456789ABCDEFG";
const ADDR_CHARLIE = "GCHARLIE1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ123456789AB";
const ADDR_DAVE = "GDAVE1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ123456789ABCDEF";

describe('ReferralService - Multi-Level Referral Tree', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset all mocks completely
    pool.query.mockReset();
    pool.connect.mockReset();
  });

  describe('registerReferral', () => {
    it('should reject self-referral', async () => {
      await expect(
        registerReferral(ADDR_ALICE, ADDR_ALICE)
      ).rejects.toThrow('Referrer and referee cannot be the same address');
    });

    it('should reject invalid Stellar addresses', async () => {
      await expect(registerReferral("INVALID", ADDR_ALICE)).rejects.toThrow(
        "Invalid Stellar public key",
      );
      await expect(registerReferral(ADDR_ALICE, "INVALID")).rejects.toThrow(
        "Invalid Stellar public key",
      );
    });

    it('should register a valid referral with cycle check', async () => {
      const mockClient = {
        query: jest.fn()
          .mockResolvedValueOnce({ rows: [] }) // BEGIN
          .mockResolvedValueOnce({ rows: [{ id: 1 }] }) // insert referrals
          .mockResolvedValueOnce({ rows: [] }) // insert referral_tree
          .mockResolvedValueOnce({ rows: [] }) // update profile
          .mockResolvedValueOnce({ rows: [] }), // COMMIT
        release: jest.fn(),
      };

      pool.query
        .mockResolvedValueOnce({ rows: [] }) // cycle check
        .mockResolvedValueOnce({ rows: [] }); // parent depth check
      pool.connect.mockResolvedValue(mockClient);

      const result = await registerReferral(ADDR_ALICE, ADDR_BOB);
      expect(result).toBeTruthy();
      expect(mockClient.release).toHaveBeenCalled();
    });
  });

  describe('processMultiLevelPayout', () => {
    it('should skip payout if referee has prior completed jobs', async () => {
      pool.query.mockResolvedValueOnce({ rows: [{ cnt: '2' }] });

      const result = await processMultiLevelPayout('job-1', ADDR_ALICE, '100.0000000');
      expect(result).toEqual([]);
    });

    it('should calculate 3-level bonuses correctly', async () => {
      const mockClient = {
        query: jest.fn().mockResolvedValue({ rows: [] }),
        release: jest.fn(),
      };

      pool.query
        .mockResolvedValueOnce({ rows: [{ cnt: '0' }] }) // no prior jobs
        .mockResolvedValueOnce({ rows: [{ parent_address: ADDR_BOB }] }) // L1
        .mockResolvedValueOnce({ rows: [{ parent_address: ADDR_CHARLIE }] }) // L2
        .mockResolvedValueOnce({ rows: [{ parent_address: ADDR_DAVE }] }) // L3
        .mockResolvedValueOnce({ rows: [] }); // no L4

      pool.connect.mockResolvedValue(mockClient);

      const result = await processMultiLevelPayout('job-1', ADDR_ALICE, '100.0000000');

      expect(result).toHaveLength(3);
      expect(result[0].recipient).toBe(ADDR_BOB);
      expect(result[0].bonusXlm).toBe('2.0000000'); // 2%
      expect(result[1].recipient).toBe(ADDR_CHARLIE);
      expect(result[1].bonusXlm).toBe('0.7500000'); // 0.75%
      expect(result[2].recipient).toBe(ADDR_DAVE);
      expect(result[2].bonusXlm).toBe('0.2500000'); // 0.25%
    });

    it('should handle single-level correctly', async () => {
      const mockClient = {
        query: jest.fn().mockResolvedValue({ rows: [] }),
        release: jest.fn(),
      };

      pool.query
        .mockResolvedValueOnce({ rows: [{ cnt: '0' }] }) // no prior jobs
        .mockResolvedValueOnce({ rows: [{ parent_address: ADDR_BOB }] }) // L1
        .mockResolvedValueOnce({ rows: [] }); // no L2

      pool.connect.mockResolvedValue(mockClient);

      const result = await processMultiLevelPayout('job-1', ADDR_ALICE, '100.0000000');

      expect(result).toHaveLength(1);
      expect(result[0].bonusXlm).toBe('2.0000000');
    });

    it('should return empty array for root user', async () => {
      const mockClient = {
        query: jest.fn().mockResolvedValue({ rows: [] }),
        release: jest.fn(),
      };

      pool.query
        .mockResolvedValueOnce({ rows: [{ cnt: '0' }] }) // no prior jobs
        .mockResolvedValueOnce({ rows: [] }); // no parent

      pool.connect.mockResolvedValue(mockClient);

      const result = await processMultiLevelPayout('job-1', ADDR_ALICE, '100.0000000');
      expect(result).toEqual([]);
    });
  });

  describe('getReferralStats', () => {
    it('should return comprehensive stats', async () => {
      pool.query
        .mockResolvedValueOnce({
          rows: [{
            total_referrals: '5',
            paid_referrals: '2',
            pending_referrals: '3',
            total_earned_xlm: '5.5',
          }],
        })
        .mockResolvedValueOnce({
          rows: [{ tree_total_xlm: '1.2', tree_payout_count: '3' }],
        })
        .mockResolvedValueOnce({ rows: [] }) // referees
        .mockResolvedValueOnce({ rows: [] }); // payouts

      const stats = await getReferralStats(ADDR_ALICE);

      expect(stats.totalReferrals).toBe(5);
      expect(stats.paidReferrals).toBe(2);
      expect(stats.pendingReferrals).toBe(3);
      expect(stats.totalEarnedXlm).toBe('5.5000000');
      expect(stats.treeEarnedXlm).toBe('1.2000000');
    });

    it('should handle user with no referrals', async () => {
      pool.query
        .mockResolvedValueOnce({
          rows: [{
            total_referrals: '0',
            paid_referrals: '0',
            pending_referrals: '0',
            total_earned_xlm: '0',
          }],
        })
        .mockResolvedValueOnce({
          rows: [{ tree_total_xlm: '0', tree_payout_count: '0' }],
        })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      const stats = await getReferralStats(ADDR_ALICE);

      expect(stats.totalReferrals).toBe(0);
      expect(stats.referees).toEqual([]);
    });
  });

  describe('getReferralTree', () => {
    it('should build hierarchical tree', async () => {
      pool.query
        .mockResolvedValueOnce({
          rows: [
            {
              child_address: ADDR_BOB,
              parent_address: ADDR_ALICE,
              rel_level: 1,
              display_name: 'Bob',
              earned_xlm: '2.0',
            },
            {
              child_address: ADDR_CHARLIE,
              parent_address: ADDR_BOB,
              rel_level: 2,
              display_name: 'Charlie',
              earned_xlm: '0.75',
            },
          ],
        })
        .mockResolvedValueOnce({
          rows: [{ display_name: 'Alice' }],
        });

      const tree = await getReferralTree(ADDR_ALICE);

      expect(tree.address).toBe(ADDR_ALICE);
      expect(tree.displayName).toBe('Alice');
      expect(tree.children).toHaveLength(1);
      expect(tree.children[0].address).toBe(ADDR_BOB);
      expect(tree.children[0].children).toHaveLength(1);
      expect(tree.children[0].children[0].address).toBe(ADDR_CHARLIE);
    });

    it('should return empty tree for user without referrals', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ display_name: 'Alice' }] });

      const tree = await getReferralTree(ADDR_ALICE);

      expect(tree.address).toBe(ADDR_ALICE);
      expect(tree.children).toEqual([]);
    });
  });
});
