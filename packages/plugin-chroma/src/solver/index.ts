import {
  validateAndBuildProposal,
  buildSignedProposalResponse,
} from './transaction_helpers';

export const buildResponse = async (event: any, config: object) => {
  try {
    const proposal = await validateAndBuildProposal(event);

    if (proposal) {
      return await buildSignedProposalResponse(proposal, config);
    }
  } catch (error) {
    console.error('Error building response:', error);
  }
}
