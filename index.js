require('dotenv').config();
const { Client } = require('splinterlands-dhive-sl');
const axios = require('axios');

const hiveClient = new Client({ nodes: JSON.parse(process.env.RPC_NODES) });

const NUMBER_OF_RUNI = +process.env.NUMBER_OF_RUNI;
const RUNI_PROXY_URL = process.env.RUNI_PROXY_URL;
const SPLINTERLANDS_API_URL = process.env.SPLINTERLANDS_API_URL;
const RUNI_ACCOUNT_NAME = process.env.RUNI_ACCOUNT_NAME;

const START_FROM = 0;
let CURRENT_RUNI_NUMBER = 1;
let RUNI_ERROR_NUMBER = null;
let RUNI_ERROR_COUNT = 1;

let HISTORY;

async function main() {
    HISTORY = [];
    // eslint-disable-next-line no-constant-condition
    while (true) {
        await matchAllRuniDelegations().then(() => {
            console.log('done');
        }).catch((error) => {
            console.log('error', error);
            if (RUNI_ERROR_NUMBER === CURRENT_RUNI_NUMBER) {
                if (RUNI_ERROR_COUNT > 3) {
                    RUNI_ERROR_COUNT = 0;
                    CURRENT_RUNI_NUMBER++;
                } else {
                    RUNI_ERROR_COUNT++;
                }
            } else {
                RUNI_ERROR_NUMBER = CURRENT_RUNI_NUMBER;
            }
        });
    }
}

main();


async function hydrateAllRuni() {
    const chunkSize = 10;
    const allRuni = Array.from({ length: NUMBER_OF_RUNI }, (_, i) => i + 1);

    for (let i = 0; i <= NUMBER_OF_RUNI; i += chunkSize) {
        if (i < START_FROM) {
            continue;
        }
        const chunk = allRuni.slice(i, i + chunkSize);
        const results = await Promise.all(chunk.map(
            (CURRENT_RUNI_NUMBER) => axios.get(`${RUNI_PROXY_URL}/api/hydrate-assignment/${CURRENT_RUNI_NUMBER}`)
        ));
        results.forEach(((result, j) => {
            const CURRENT_RUNI_NUMBER = i + j + 1;
            if (result?.data?.success) {
                historyLog('HYDRATED RUNI: ', CURRENT_RUNI_NUMBER);
            } else {
                historyLog('ERROR HYDRATING RUNI: ', CURRENT_RUNI_NUMBER);
            }
        }));
    }
}

async function getAllRuniCards() {
    const allRuniCardsResponse = await axios.get(`${SPLINTERLANDS_API_URL}/cards/collection/${RUNI_ACCOUNT_NAME}`);
    const allRuniCards = allRuniCardsResponse?.data?.cards || [];
    if (allRuniCards.length === 0) {
        throw Error('Cannot find runi cards!');
    }
    return allRuniCards;
}

async function matchAllRuniDelegations() {
    let allRuniCards = await getAllRuniCards();
    while (CURRENT_RUNI_NUMBER <= NUMBER_OF_RUNI) {
        if (CURRENT_RUNI_NUMBER < START_FROM) {
            continue;
        }
        if (CURRENT_RUNI_NUMBER % 10 === 0) {
            // refresh cards data periodically
            allRuniCards = await getAllRuniCards();
        }

        const hydrateResult = await axios.get(`${RUNI_PROXY_URL}/api/hydrate-assignment/${CURRENT_RUNI_NUMBER}`);
        if (hydrateResult?.data?.success) {
            historyLog('HYDRATED RUNI: ', CURRENT_RUNI_NUMBER);
        } else {
            historyLog('ERROR HYDRATING RUNI: ', CURRENT_RUNI_NUMBER);
            throw Error(`ERROR HYDRATING RUNI ${CURRENT_RUNI_NUMBER}`);
        }

        const layersResult = await axios.get(`https://runi.splinterlands.com/layers/${CURRENT_RUNI_NUMBER}.json`);
        const cardId = layersResult?.data?.cardId;
        if (!cardId) {
            historyLog('CANT FIND RUNI CARD ID: ', CURRENT_RUNI_NUMBER);
            throw Error(`CANT FIND RUNI CARD ID ${CURRENT_RUNI_NUMBER}`);
        }
        const runiCard = allRuniCards.find((card) => card.uid === cardId);
        if (!runiCard) {
            historyLog('CANT FIND RUNI CARD: ', CURRENT_RUNI_NUMBER);
        }
        const result = await axios.get(`${RUNI_PROXY_URL}/api/token-assignment/${CURRENT_RUNI_NUMBER}`);
        if (result?.data) {
            // RUNI SHOULD BE ASSIGNED
            const shouldBeAssignedTo = result.data;
            if (shouldBeAssignedTo !== runiCard.delegated_to) {
                historyLog('MISMATCH FOR', CURRENT_RUNI_NUMBER, 'SHOULD BE ASSIGNED TO', shouldBeAssignedTo, 'BUT CURRENT DELEGATION IS', runiCard.delegated_to);
                if (runiCard.delegated_to) {
                    historyLog(CURRENT_RUNI_NUMBER, 'ALREADY DELEGATED, UNDELEGATING FIRST');
                    await undelegate(cardId);
                }
                historyLog('DELEGATING', CURRENT_RUNI_NUMBER, 'TO', shouldBeAssignedTo);
                await delegate(shouldBeAssignedTo, cardId);
            } else {
                historyLog(CURRENT_RUNI_NUMBER, 'CORRECTLY ASSIGNED');
            }
        } else {
            // RUNI SHOULD NOT BE ASSIGNED
            if (runiCard.delegated_to) {
                historyLog(CURRENT_RUNI_NUMBER, 'SHOULD NOT BE ASSIGNED, BUT IT IS, TRIGGERING UNDELEGATE');
                await undelegate(cardId);
            } else {
                historyLog(CURRENT_RUNI_NUMBER, 'CORRECTLY UNASSIGNED');
            }
        }
        CURRENT_RUNI_NUMBER++;
    }
    CURRENT_RUNI_NUMBER = 1;
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