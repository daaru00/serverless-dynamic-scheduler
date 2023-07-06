/**
 * AWS Services
 */
const DynamoDB = require('aws-sdk/clients/dynamodb')
const db = new DynamoDB.DocumentClient({
	logger: console
})
const StepFunctions = require('aws-sdk/clients/stepfunctions')
const stepFunctions = new StepFunctions({
	logger: console
})
const EventBridge = require('aws-sdk/clients/eventbridge')
const eventBridge = new EventBridge({
	logger: console
})

/**
 * Lambda handler
 * @param {object} event
 * @param {object} event.detail
 */
exports.handler = async (event) => {
	console.log(JSON.stringify(event))
	const { id, reason = 'stopped' } = event.detail

	const { Item: schedule } = await db.get({
		TableName: process.env.TABLE_NAME,
		Key: {
			id
		}
	}).promise()

	if (!schedule || !schedule.executionArn) {
		console.log('Schedule not found')
		return
	}

	const currentExecution = await stepFunctions.describeExecution({
		executionArn: schedule.executionArn
	}).promise()

	if (currentExecution.status === 'RUNNING') {
		await stepFunctions.stopExecution({
			executionArn: schedule.executionArn,
			error: reason
		}).promise()
	}

	await db.delete({
		TableName: process.env.TABLE_NAME,
		Key: {
			id
		}
	}).promise()

	await eventBridge.putEvents({
		Entries: [{
			EventBusName: process.env.EVENT_BUS_NAME,
			Source: process.env.EVENT_SOURCE,
			DetailType: 'Schedule Stopped',
			Detail: JSON.stringify(schedule)
		}]
	}).promise()
}
