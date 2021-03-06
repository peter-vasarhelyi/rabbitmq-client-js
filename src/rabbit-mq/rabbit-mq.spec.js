'use strict';

const amqp = require('amqplib');
const RabbitMq = require('./rabbit-mq');
const chai = require('chai');
const sinon = require('sinon');
const chaiAsPromised = require('chai-as-promised');
const sinonChai = require('sinon-chai');
const EventEmitter = require('events');


chai.use(sinonChai);
chai.use(chaiAsPromised);

const expect = chai.expect;

const config = {
  default: {
    url: 'amqp://test:secret@192.168.40.10:5672/cubebloc'
  }
};
const queueName = 'test-queue';

describe('RabbitMQ', function() {
  let rabbitMq;
  let sandbox = sinon.sandbox.create();

  let connectionMock;
  let channelMock;

  beforeEach(async function() {
    channelMock = Object.assign(new EventEmitter(), {
      sendToQueue: sandbox.stub().returns(true),
      deleteQueue: sandbox.stub().resolves(true),
      purgeQueue: sandbox.stub().resolves(true),
      assertQueue: sandbox.stub().resolves(true)
    });

    connectionMock = {
      createChannel: sandbox.stub().resolves(channelMock),
      close: sandbox.stub().returns(true)
    };

    sandbox.stub(amqp, 'connect').resolves(connectionMock);
    rabbitMq = new RabbitMq(config, queueName);
  });

  afterEach(async function() {
    sandbox.restore();
  });

  it('#connect should call amqp connect with rigth parameters', async function() {
    await rabbitMq.connect();
    expect(amqp.connect).to.have.been.calledWith(
      'amqp://test:secret@192.168.40.10:5672/cubebloc',
      { servername: '192.168.40.10' }
    );
  });

  it('#connect cache the connection', async function() {
    const connections = {};
    await rabbitMq.connect(connections);
    const connection = await connections.default;

    expect(connection).to.be.equal(connectionMock);
  });

  it('#connect should reuse existing connection if it was already created', async function() {
    const localConnectionMock = {
      close: sandbox.stub().resolves(true)
    };
    const connections = { default: Promise.resolve(localConnectionMock) };
    await rabbitMq.connect(connections);

    await rabbitMq.closeConnection();
    expect(localConnectionMock.close).to.have.been.calledOnce;
  });

  it('#createChannel should check if connection is ready', async function() {
    await expect(rabbitMq.createChannel()).to.be.rejectedWith('No RabbitMQ connection');
    await rabbitMq.connect();
    await expect(rabbitMq.createChannel()).to.be.fulfilled;
  });

  it('#createChannel should cache the channel and assert the queue', async function() {
    const assertQueueValue = { testing: 123 };
    channelMock.assertQueue = sandbox.stub().resolves(assertQueueValue);

    const channels = {};
    const assertedQueues = {};
    await rabbitMq.connect();
    await rabbitMq.createChannel(channels, assertedQueues);

    const channel = await channels.default;

    expect(channel).to.be.equal(channelMock);
    expect(channelMock.assertQueue).to.have.been.calledWith(queueName, { durable: false });
    expect(await assertedQueues[queueName]).to.eq(assertQueueValue);
  });

  it('#createChannel should reuse existing channel and assertQueue if it was already created', async function() {
    const localChannelMock = Object.assign({}, channelMock);
    const channels = { default: Promise.resolve(localChannelMock) };

    const assertedQueues = {};
    assertedQueues[queueName] = 'called';

    await rabbitMq.connect();
    await rabbitMq.createChannel(channels, assertedQueues);

    expect(await rabbitMq.getChannel()).to.be.eq(localChannelMock);
    expect(localChannelMock.assertQueue).not.to.have.been.called;
  });

  it('#createChannel should check if queueName was set', async function() {
    rabbitMq = new RabbitMq(config);
    await rabbitMq.connect();
    await expect(rabbitMq.createChannel()).to.be.rejectedWith('No RabbitMQ queue');
  });

  it('#insert should call sentToQueue', async function() {
    const data = { test: 'data' };
    await rabbitMq.connect();
    await rabbitMq.createChannel();
    rabbitMq.insert(data);
    expect(channelMock.sendToQueue).to.have.been.calledWith(queueName, new Buffer(JSON.stringify(data)));
  });

  it('#insertWithGroupBy should call sentToQueue', async function() {
    const groupBy = 'me.login';
    const data = { test: 'data' };
    await rabbitMq.connect();
    await rabbitMq.createChannel();

    rabbitMq.insertWithGroupBy(groupBy, data);
    expect(channelMock.sendToQueue).to.have.been.calledWith(
      queueName,
      new Buffer(JSON.stringify(data)),
      { headers: { groupBy } }
    );
  });

  it('#purge should empty the queue', async function() {
    await rabbitMq.connect();
    await rabbitMq.createChannel();

    await rabbitMq.purge();

    expect(channelMock.purgeQueue).to.have.been.calledWith(queueName);
  });

  it('#closeConnection should close the rabbitMq connection', async function() {
    await rabbitMq.connect();
    await rabbitMq.createChannel();

    await rabbitMq.closeConnection();
    expect(connectionMock.close).to.have.been.calledOnce;
  });

  it('#destroy should delete the queue', async function() {
    await rabbitMq.connect();
    await rabbitMq.createChannel();

    await rabbitMq.destroy();
    expect(channelMock.deleteQueue).to.have.been.calledWith(queueName);
  });

  describe('with dead channel', function() {

    it('should remove channel from the cache', async function() {
      const channels = {};
      const assertedQueues = {};

      await rabbitMq.connect();
      await rabbitMq.createChannel(channels, assertedQueues);

      expect(channels.default).not.to.be.undefined;
      expect(assertedQueues[queueName]).not.to.be.undefined;

      rabbitMq.getChannel().emit('close');
      expect(channels.default).to.be.undefined;
      expect(assertedQueues[queueName]).to.be.undefined;
    });

  });
});
