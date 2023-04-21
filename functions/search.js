const express = require('express');
const serverless = require('serverless-http');
const app = express();


import { odonnell_corpus, hellenistic_corpus } from '../../public/corpora';
import metaDataArray from '../../public/data/hellenistic_author_metadata.json';
import fallbackMetaData from '../../public/data/1bc-1ad-meta.json'

export const config = {
    api: {
        responseLimit: '8mb',
    },
}

console.log('loading api ...');
const metaDataDict = metaDataArray.reduce((acc, obj) => {
    acc[`${obj.authorId}_${obj.workId}`] = obj;
    return acc;
}, {});
/*
Fallback metadata example:
{
    "author": "AELIANUS Tact. ",
    "authorId": "0546",
    "date": "A.D. 1-2",
    "geo": "A.D. 1-2",
    "title": "Tactica",
    "workId": "0546_001",
    "wordCount": "9,893"
  },
*/

const fallbackMetaDataDict = fallbackMetaData.reduce((acc, obj) => {
    acc[obj.workId] = obj;
    return acc;
}, {});


// const hellenistic_author_ids = new Set(hellenistic_corpus.map(entry => entry.id));
const odonnell_corpus_pairs = new Set(odonnell_corpus.map(entry => `${entry.authorId}_${entry.workId}`));
const hellenistic_author_dict = Object.fromEntries(hellenistic_corpus.map(entry => [entry.id, entry]));
// const odonnell_corpus_dict = Object.fromEntries(odonnell_corpus.map(entry => [`${entry.authorId}_${entry.workId}`, entry]));
// const dataPath = '../../public/data/json_sentence_pairs';

async function* readFromJsonFiles(searchTerms, useOdonnellCorpusFlag = false) {
    const dataPath = path.join(process.cwd(), 'public/data/json_sentence_pairs');
    const jsonPath = dataPath
    const jsonFiles = await fs.readdir(jsonPath);

    const filteredFiles = useOdonnellCorpusFlag ? jsonFiles.filter(file => odonnell_corpus.find(entry => file.startsWith(entry.authorId) && file.endsWith(entry.workId))) : jsonFiles;

    for (const file of filteredFiles) {
        if (file.endsWith('.json')) {
            const [author_id, work_id] = file.split('.').slice(0, 2).map(id => id.slice(3));

            if (useOdonnellCorpusFlag && !odonnell_corpus_pairs.has(`${author_id}_${work_id}`)) {
                continue;
            }
            // Get metadata if it exists
            const metadata = metaDataDict[`${author_id}_${work_id}`];

            // Retrieve the author object
            const author = hellenistic_author_dict[author_id];
            let fallbackMetadata;
            if (!author) {
                fallbackMetadata = fallbackMetaDataDict[`${author_id}_${work_id}`]
            }

            const content = await fs.readFile(path.join(jsonPath, file), 'utf8');
            let objects = [];
            try {
                objects = JSON.parse(content);
            } catch (e) {
                console.log('error parsing json', e, file);
            }
            for (const obj of objects) {
                if (Object.keys(obj).length > 0) {
                    const { tokens, lemmas } = obj;

                    if (!tokens || !lemmas) {
                        console.log('missing tokens or lemmas', obj);
                        continue;
                    }
                    for (const term of searchTerms) {
                        const termNoAccentsLower = term.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
                        const termNoAccentsOrBreathingMarksLower = termNoAccentsLower.replace(/[\u0345\u0301\u0300]/g, '');
                        const tokensNoAccentsLower = tokens.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
                        const tokensNoAccentsOrBreathingMarksLower = tokensNoAccentsLower.replace(/[\u0345\u0301\u0300]/g, '');
                        const lemmasNoAccentsLower = lemmas.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
                        const lemmasNoAccentsOrBreathingMarksLower = lemmasNoAccentsLower.replace(/[\u0345\u0301\u0300]/g, '');
                        if (tokensNoAccentsOrBreathingMarksLower.includes(termNoAccentsOrBreathingMarksLower) || lemmasNoAccentsOrBreathingMarksLower.includes(termNoAccentsOrBreathingMarksLower)) {
                            // Add the author object to the result
                            obj.metadata = { ...metadata, ...fallbackMetaData, author: author || fallbackMetadata ? fallbackMetadata?.name : 'no data' };
                            yield obj;
                            break;
                        }
                    }
                }
            }
        }
    }
}

console.log('api loaded');

// Your existing API function
async function searchAPI(req, res) {
    // start timer
    const start = Date.now();
    const { query, useOdonnellCorpus } = req.query;

    console.log({ query, useOdonnellCorpus })
    if (!query) {
        return res.status(400).json({ error: 'Query string parameter "query" is required.' });
    }

    const searchTerms = Array.isArray(query) ? query : [query];
    const results = [];

    for await (const item of readFromJsonFiles(searchTerms, useOdonnellCorpus)) {
        results.push(item);
    }

    if (results.length === 0) {
        return res.status(404).json({ error: 'No results found.' });
    }

    const truncatedResults = results.slice(0, 25 > results.length ? results.length : 25);

    res.status(200).json({
        count: results.length,
        // format time as seconds to two decimal places
        time: (Date.now() - start) / 1000,
        results: truncatedResults,
        responseSizeMB: (JSON.stringify(truncatedResults).length / 1024 / 1024).toFixed(2),
    });
}

// Add the searchAPI function as a route in the Express app
app.get('/search', searchAPI);

// Export the serverless-http handler
module.exports.handler = serverless(app);