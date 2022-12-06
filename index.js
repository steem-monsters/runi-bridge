require('dotenv').config();
const { Client } = require('splinterlands-dhive-sl');
const { ethers } = require('ethers');
const axios = require('axios');
const runiAbi = require('./runiAbi.json');

const hiveClient = new Client({ nodes: JSON.parse(process.env.RPC_NODES) });
const blockSize = 100;
const providers = {};
const contracts = {};
const someBlockNumber = undefined;

main();

async function main() {
    const contract = Contract(process.env);
    const provider = contract.provider;

    const latestBlock = (await provider.getBlock('latest')).number;
    const lastProcessedBlock = parseInt(someBlockNumber ?? process.env.RUNI_INITIAL_BLOCK);

    const endBlock = Math.min(
        latestBlock - 5,
        lastProcessedBlock + blockSize
    );

    await handleStakeEvents(contract, lastProcessedBlock, endBlock);
    await handleUnstakeEvents(contract, lastProcessedBlock, endBlock);

    process.exit();
}

function Contract(env, api = 'alchemy') {
	if (contracts[api] && contracts[api].address === env.RUNI_CONTRACT_ADDRESS) {
		return contracts[api];
	}

	if (!providers[api]) {
		providers[api] = new ethers.providers.StaticJsonRpcProvider({
			url:
				api === 'alchemy'
					? `https://eth-${env.ETH_NETWORK}.g.alchemy.com/v2/${env.ALCHEMY_KEY}`
					: `https://${env.ETH_NETWORK}.infura.io/v3/${env.INFURA_KEY}`,
			skipFetchSetup: true,
		});
	}

	contracts[api] = new ethers.Contract(
		env.RUNI_CONTRACT_ADDRESS.toLowerCase(),
		runiAbi.abi,
		providers[api]
	);

	return contracts[api];
}

async function handleStakeEvents(contract, lastProcessedBlock, endBlock) {
    const filter = contract.filters.Stake();
    const stakeEvents = await contract.queryFilter(
        filter,
        lastProcessedBlock,
        endBlock
    );

    for (const event of stakeEvents) {
        const [_owner, id, _to] = event.args || [];
        const tokenID = parseInt(id._hex, 16);
        const hiveUser = await contract.cardStakedTo(tokenID);

        const cardId = await getCardId(tokenID);
        await delegate(hiveUser.toLowerCase(), cardId);
    }
}

async function handleUnstakeEvents(contract, lastProcessedBlock, endBlock) {
    const filter = contract.filters.Unstake();
    const unstakeEvents = await contract.queryFilter(
        filter,
        lastProcessedBlock,
        endBlock
    );

    for (const event of unstakeEvents) {
        const [_owner, id] = event.args || [];
        const tokenID = parseInt(id._hex, 16);

        const cardId = await this.getCardId(tokenID);
        await undelegate(cardId);
    }
}

async function getCardId(tokenId) {
    // const metadata = await axios.get(`https://runi.splinterlands.com/metadata/${tokenId}.json`);
    // return metadata.data.cardId;
    // TODO: get this from layers.json when it is ready as the below will
    // not be correct when it is a gold foil
    return `C2-505-${tokenId.toString().padStart(10, '0')}`;
}

async function delegate(hiveUser, cardId) {
    await hiveClient.broadcast.customJson({
        account: process.env.RUNI_ACCOUNT_NAME,
        id: `${process.env.TX_PREFIX}sm_delegate_cards`,
        json: {
            to: hiveUser,
            cards: [cardId]
        },
    }, process.env.RUNI_ACCOUNT_POSTING_KEY);
}

async function undelegate(cardId) {
    await hiveClient.broadcast.customJson({
        account: process.env.RUNI_ACCOUNT_NAME,
        id: `${process.env.TX_PREFIX}sm_undelegate_cards`,
        json: {
            cards: [cardId]
        },
    }, process.env.RUNI_ACCOUNT_POSTING_KEY);
}