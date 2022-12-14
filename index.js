require('dotenv').config();
const { Client } = require('splinterlands-dhive-sl');
const axios = require('axios');

const hiveClient = new Client({ nodes: JSON.parse(process.env.RPC_NODES) });

const NUMBER_OF_RUNI = +process.env.NUMBER_OF_RUNI;
const RUNI_PROXY_URL = process.env.RUNI_PROXY_URL;
const SPLINTERLANDS_API_URL = process.env.SPLINTERLANDS_API_URL;
const RUNI_ACCOUNT_NAME = process.env.RUNI_ACCOUNT_NAME;

const START_FROM = 0;

const HISTORY = [];

matchAllRuniDelegations().then(() => {
    console.log('done');
    console.log(HISTORY);
}).catch((error) => {
    console.log('error', error);
    console.log(HISTORY);
});

async function hydrateAllRuni() {
    const chunkSize = 10;
    const allRuni = Array.from({ length: NUMBER_OF_RUNI }, (_, i) => i + 1);

    for (let i = 0; i <= NUMBER_OF_RUNI; i += chunkSize) {
        if (i < START_FROM) {
            continue;
        }
        const chunk = allRuni.slice(i, i + chunkSize);
        const results = await Promise.all(chunk.map(
            (runiNumber) => axios.get(`${RUNI_PROXY_URL}/api/hydrate-assignment/${runiNumber}`)
        ));
        results.forEach(((result, j) => {
            const runiNumber = i + j + 1;
            if (result?.data?.success) {
                historyLog('HYDRATED RUNI: ', runiNumber);
            } else {
                historyLog('ERROR HYDRATING RUNI: ', runiNumber);
            }
        }));
    }
}

async function matchAllRuniDelegations() {
    const allRuniCardsResponse = await axios.get(`${SPLINTERLANDS_API_URL}/cards/collection/${RUNI_ACCOUNT_NAME}`);
    const allRuniCards = allRuniCardsResponse?.data?.cards || [];
    if (allRuniCards.length === 0) {
        throw Error('Cannot find runi cards!');
    }
    for (let runiNumber = 1; runiNumber <= NUMBER_OF_RUNI; runiNumber++) {
        if (runiNumber < START_FROM) {
            continue;
        }
        const layersResult = await axios.get(`https://runi.splinterlands.com/layers/${runiNumber}.json`);
        const cardId = layersResult?.data?.cardId;
        if (!cardId) {
            historyLog('CANT FIND RUNI CARD ID: ', runiNumber);
            continue;
        }
        const runiCard = allRuniCards.find((card) => card.uid === cardId);
        if (!runiCard) {
            historyLog('CANT FIND RUNI CARD: ', runiNumber);
        }
        const result = await axios.get(`${RUNI_PROXY_URL}/api/token-assignment/${runiNumber}`);
        if (result?.data) {
            // RUNI SHOULD BE ASSIGNED
            const shouldBeAssignedTo = result.data;
            if (shouldBeAssignedTo !== runiCard.delegated_to) {
                historyLog('MISMATCH FOR', runiNumber, 'SHOULD BE ASSIGNED TO', shouldBeAssignedTo, 'BUT CURRENT DELEGATION IS', runiCard.delegated_to);
                if (runiCard.delegated_to) {
                    historyLog(runiNumber, 'ALREADY DELEGATED, UNDELEGATING FIRST');
                    await undelegate(cardId);
                }
                historyLog('DELEGATING', runiNumber, 'TO', shouldBeAssignedTo);
                await delegate(shouldBeAssignedTo, cardId);
            } else {
                historyLog(runiNumber, 'CORRECTLY ASSIGNED');
            }
        } else {
            // RUNI SHOULD NOT BE ASSIGNED
            if (runiCard.delegated_to) {
                historyLog(runiNumber, 'SHOULD NOT BE ASSIGNED, BUT IT IS, TRIGGERING UNDELEGATE');
                await undelegate(cardId);
            } else {
                historyLog(runiNumber, 'CORRECTLY UNASSIGNED');
            }
        }
    }
}

function historyLog(...params) {
    const message = params.join(' ');
    console.log(message);
    HISTORY.push(message);
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
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

        // const cardId = await getCardId(tokenID);
        // await delegate(hiveUser.toLowerCase(), cardId);
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

        // const cardId = await this.getCardId(tokenID);
        // await undelegate(cardId);
    }
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
    // avoid too many transactions in the same block
    await sleep(600);
}

async function undelegate(cardId) {
    await hiveClient.broadcast.customJson({
        account: process.env.RUNI_ACCOUNT_NAME,
        id: `${process.env.TX_PREFIX}sm_undelegate_cards`,
        json: {
            cards: [cardId]
        },
    }, process.env.RUNI_ACCOUNT_POSTING_KEY);
    // avoid too many transactions in the same block
    await sleep(600);
}