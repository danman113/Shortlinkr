const express = require('express')
const crypto = require('crypto')
const { resolve } = require('path')
const redis = require('redis')
const bodyParser = require('body-parser');
const { Schema, connect, model, connection } = require('mongoose')
const { promisify } = require('util')
const app = express()
const port = process.env.PORT || 5000
const redisClient = redis.createClient({
  host: 'cache'
})
connect('mongodb://db/users', { useNewUrlParser: true, useUnifiedTopology: true, useFindAndModify: false })
connection.on('error', err => {
  console.error('Redis Error: ', err)
})
const rget = promisify(redisClient.get).bind(redisClient)
const rset = promisify(redisClient.set).bind(redisClient)

const baseMap = {
  '=': '',
  '/': '_',
  '+': '-'
}
const safeBase = (str) => {
  const hash = String(crypto.createHash('sha256').update(str).digest('base64'))
  return hash.split('').slice(0, 8).map(char => baseMap[char] ?? char).join('')
}

const LinkSchema = new Schema({
  url: { type : String, required: true },
  shortlink: { type : String, index: true, unique: true, required : true },
  hits: Number,
  expiration: Date,
  ip: String
}, { timestamps: true })

const Link = model('link', LinkSchema)

const getShortLink = async (shortlink) => {
  const redisQuery = 'link:' + shortlink
  const link = await rget(redisQuery)
  if (link) return link
  const freshLink = await Link.findOneAndUpdate({ shortlink }, { $inc: { hits: 1 } })
  if (freshLink) {
    const { url } = freshLink
    try {
      await rset(redisQuery, url)
    } catch (err) {
      console.error(`Could not set ${redisQuery} in cache`, err)
    }
    return url
  } else {
    return null
  }
}

const APIErrorHandlerMiddleware = (err, req, res, next) => {
  res.status(500).send(err)
}

app.get('/', (req, res) => {
  res.sendFile(resolve('./index.html'))
})

app.use(express.static('node_modules/milligram/dist'))

app.use('/api', bodyParser.json())

app.use('/api', APIErrorHandlerMiddleware)

app.post('/api/links/', async (req, res) => {
  const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress
  const { shortlink: attemptedShortLink, url, expiration } = req.body
  const shortlink = attemptedShortLink || safeBase(String(Math.random() * 0xFFFFFFF))
  const newLink = new Link({
    url,
    shortlink,
    expiration,
    ip
  })
  try {
    await newLink.save()
    res.status(200).send({
      shortlink
    })
  } catch (err) {
    if (err?.message && String(err.message).includes('duplicate key')) {
      res.status(404).send({
        err: 'Duplicate Key'
      })
    } else {
      throw err
    }
  }
})

app.get('/api/links/:id', async (req, res) => {
  const url = await getShortLink(req.params.id)
  if (url)
    res.status(200).send({ url })
  else res.status(404).send({ err: 'URL Not found' })
})

app.get('/api/links/', async (req, res) => {
  Link.find((err, links) => {
    if (err) {
      res.send(err)
    } else {
      res.send(links)
    }
  })
})

app.get('/404', (req, res) => {
  res.sendFile(resolve('./404.html'))
})

app.get('/:shortlink', async (req, res) => {
  try {
    const url = await getShortLink(req.params.shortlink)
    if (url)
      return res.redirect(302, url)
  } catch (e) {
    console.error(e)
  }
  return res.redirect(301, '/404')
})


connection.once('open', () => {
  console.log('connected to db')
  app.listen(port, () => {
    console.log(`Listening on port ${port}`)
  })
})
