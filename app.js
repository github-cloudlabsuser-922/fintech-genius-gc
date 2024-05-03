// Import necessary modules
const express = require('express');
const cosmos = require('@azure/cosmos');
const session = require('express-session');
const { OpenAIClient, AzureKeyCredential } = require("@azure/openai");

//crypto module
const crypto = require('crypto');
const algorithm = 'aes-256-cbc';
const key1 = Buffer.from('', 'utf8');
const iv = Buffer.from('', 'utf8');

const { check, validationResult } = require('express-validator');

// Set the Azure and AI Search values from environment variables
const openaiendpoint = process.env.AZURE_OPENAI_ENDPOINT;
const azureApiKey = process.env.AZURE_OPENAI_API_KEY;
const deploymentId = process.env.AZURE_OPENAI_DEPLOYMENT_ID;
const searchEndpoint = process.env.AZURE_AI_SEARCH_ENDPOINT;
const searchKey = process.env.AZURE_AI_SEARCH_API_KEY;
const searchIndex = process.env.AZURE_AI_SEARCH_INDEX;

const aiClient = new OpenAIClient(openaiendpoint, new AzureKeyCredential(azureApiKey));

// Initialize express app
const app = express();
app.use(express.json());

// Cosmos DB connection
const cosmodbendpoint = "https://fintech-credit-card.documents.azure.com:443/";
const key = "";
const { CosmosClient } = cosmos;
const client = new CosmosClient({ endpoint: cosmodbendpoint, key });
const database = client.database('credit_cards');
const container = database.container('credit_card_users');

const bcrypt = require('bcrypt');
const saltRounds = 10;


app.use(session({
    secret: 'weerer23sfg34fregsgswertgergerg',
    resave: false,
    saveUninitialized: true,
    cookie: { secure: true } // Note: secure: true option requires an HTTPS connection
}));

// Login endpoint
app.post('/login', async (req, res) => {

    const { username, password } = req.body;
    const { resources } = await container.items
        .query({ query: "SELECT * FROM c WHERE c.login.username = @username", parameters: [{ name: "@username", value: username }] })
        .fetchAll();
    if (resources.length > 0) {
        const user = resources[0];
        const match = await bcrypt.compare(password, user.login.password);
        if (match) {
            req.session.user = user;
            res.json({ success: true, message: 'Logged in successfully' });
        } else {
            res.json({ success: false, message: 'Invalid username or password' });
        }
    } else {
        res.json({ success: false, message: 'Invalid username or password' });
    }
});

// Create account endpoint
app.post('/create_account',
    [
        check('login.username').isLength({ min: 5 }).withMessage('Username must be at least 5 chars long'),
        check('login.password').isLength({ min: 5 }).withMessage('Password must be at least 5 chars long'),
        check('login.email').isEmail().withMessage('Email is not valid'),
        check('first_name').exists().withMessage('First name is required'),
    ],
    async (req, res) => {
        const { login, first_name, last_name, address } = req.body;
        const { username, password, email } = login;
        console.log(username);
        console.log(username.length);
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { resources } = await container.items
            .query({ query: "SELECT * FROM c WHERE c.login.username = @username", parameters: [{ name: "@username", value: username }] })
            .fetchAll();
        if (resources.length > 0) {
            res.json({ success: false, message: 'Username already exists' });
        } else {
            console.log(`Password: ${password}, Salt Rounds: ${saltRounds}`);

            const hashedPassword = await bcrypt.hash(password, saltRounds);
            const user = {
                first_name,
                last_name,
                address,
                login: {
                    username: username,
                    email: email,
                    password: hashedPassword
                },
                cards: []
            };
            const { resource } = await container.items.create(user);
            res.json({ success: true, message: 'Account created successfully', id: resource.id });
        }
    });

// Add credit card endpoint
app.post('/add_credit_card', async (req, res) => {
    const { id, card } = req.body;
    const { resource } = await container.item(id).read();
    const newCard = {};
    console.log(crypto.randomBytes(32).toString)
    console.log(crypto.randomBytes(16))
    if (!card.number) {
        res.status(400).send({ error: 'Card number is required' });
    } else {
        const cipher = crypto.createCipheriv(algorithm, key1, iv);
        let encrypted = cipher.update(card.number.toString(), 'utf8', 'hex');
        encrypted += cipher.final('hex');
        newCard.number = encrypted;
    }
    if (card.expiry_month) newCard.expiry_month = card.expiry_month;
    if (card.expiry_year) newCard.expiry_year = card.expiry_year;
    if (card.institution) newCard.institution = card.institution;
    if (card.reward_type) newCard.reward_type = card.reward_type;
    if (card.reward_value) newCard.reward_value = card.reward_value;
    if (card.cardholderName) newCard.cardholderName = card.cardholderName;

    resource.cards.push(newCard);
    await container.item(id).replace(resource);
    res.json({ success: true, message: 'Card added successfully' });
});

// Get credit cards endpoint
app.get('/get_credit_cards/:id', async (req, res) => {
    const { id } = req.params;
    const { resource } = await container.item(id).read();
    console.log(resource);
    const decryptedCards = resource.cards.map(card => {
        if (card.number) {
            const decipher = crypto.createDecipheriv(algorithm, key1, iv);
            console.log(card.number);
            console.log(decipher);
            console.log(card.number.toString());
            let decrypted = decipher.update(card.number.toString(), 'hex', 'utf8');
            decrypted += decipher.final('utf8');
            return { ...card, number: decrypted };
        }
        return card;
    });
    res.json(decryptedCards);
});

// Logout endpoint
app.post('/logout', (req, res) => {
    req.session.destroy(err => {
        if (err) {
            res.json({ success: false, message: 'Error occurred during logout' });
        } else {
            res.json({ success: true, message: 'Logged out successfully' });
        }
    });
});

app.get('/ai_call',async (req, res) => {

    const { questionText, programArray } = req.body;

    const messages = [
        {
            role: "system",
            content: "You are an expert at finding the highest possible credit card rewards given purchases that are made. You talk to people in a confident and knowledgeable tone, like a friend."
        },
        {
            role: "user",
            content: questionText + ` I have the following credit cards available ${[...programArray]}`
        },
    ];

    console.log(`Message: ${messages.map((m) => m.content).join("\n")}`);

    const events = await aiClient.streamChatCompletions(deploymentId, messages, { 
      maxTokens: 1024,
      azureChatExtensionOptions: {
        extensions: [
          {
            endpoint: searchEndpoint,
            key: searchKey,
            indexName: searchIndex,
          },
        ],
      },
    });
    let response = "";
    for await (const event of events) {
      for (const choice of event.choices) {
        const newText = choice.delta?.content;
        if (!!newText) {
          response += newText;
          // To see streaming results as they arrive, uncomment line below
            //console.log(newText);
        }
      }
    }
    console.log(response);
    res.json(response);

});


// Start the server
const port = process.env.PORT || 5000;
const server = app.listen(port, () => console.log(`Server running on port ${port}`));

module.exports = { app, server };