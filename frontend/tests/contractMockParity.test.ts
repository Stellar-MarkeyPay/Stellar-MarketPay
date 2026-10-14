import * as contractMock from '../lib/contractMock';

describe('Contract Mock Parity', () => {
  it('should expose the same interface as the real contract entrypoints', () => {
    // Assert all expected entrypoints are available on the mock
    const expectedFunctions = [
      'mockCreateEscrow',
      'mockStartWork',
      'mockReleaseEscrow',
      'mockRefundEscrow',
      'mockGetEscrow',
      'mockGetStatus',
      'mockGetEscrowCount',
      'mockApproveRelease',
      'mockApproveRefund',
      'mockRaiseDispute',
      'mockCommitBudget',
      'mockRevealBudget',
      'mockSubmitBidCommitment',
      'mockCloseBidding',
      'mockRevealBid',
      'mockPartialRelease',
      'mockRegisterArbitrator',
      'mockOpenArbitration',
      'mockCastArbitrationVote',
      'mockResolveArbitration'
    ];

    for (const fnName of expectedFunctions) {
      expect(typeof (contractMock as any)[fnName]).toBe('function');
    }
  });
});
