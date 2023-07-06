const { CronJob } = require('cron')

/**
 * AWS Services
 */
const DynamoDB = require('aws-sdk/clients/dynamodb')
const db = new DynamoDB.DocumentClient({
	logger: console
})
const EventBridge = require('aws-sdk/clients/eventbridge')
const eventBridge = new EventBridge({
	logger: console
})
const StepFunctions = require('aws-sdk/clients/stepfunctions')
const stepFunctions = new StepFunctions({
	logger: console
})

/**
 * Lambda handler
 * @param {object} event
 * @param {object} event.detail
 */
exports.handler = async (event) => {
	console.log(JSON.stringify(event))
	const { id } = event.detail

	let { Item: schedule } = await db.get({
		TableName: process.env.TABLE_NAME,
		Key: {
			id
		}
	}).promise()

	if (!schedule) {
		throw new Error('Schedule not found')
	}

	// Schedule without cron expression are executed only once
	if (!schedule.cron) {
		await db.delete({
			TableName: process.env.TABLE_NAME,
			Key: {
				id
			}
		}).promise()
		return
	}

	schedule.counter++
	if (schedule.limit > 0 && schedule.counter >= schedule.limit) {
		await eventBridge.putEvents({
			Entries: [{
				EventBusName: process.env.EVENT_BUS_NAME,
				Source: process.env.EVENT_SOURCE,
				DetailType: 'Schedule Stop',
				Detail: JSON.stringify({
					id,
					reason: 'Count Limit Reached'
				})
			}]
		}).promise()
		return
	}

	const cronJob = new CronJob(schedule.cron)
	const nextDate = cronJob.nextDate().toJSDate()

	// Start execution
	const execution = await stepFunctions.startExecution({
		stateMachineArn: process.env.STATE_MACHINE_ARN,
		input: JSON.stringify({
			timestamp: nextDate.toISOString(),
			schedule
		})
	}).promise()

	// Save execution
	await db.put({
		TableName: process.env.TABLE_NAME,
		Item: {
			...schedule,
			executionArn: execution.executionArn,
			lastTickDate: execution.startDate.toISOString(),
			nextTickDate: nextDate.toISOString()
		}
	}).promise()
}
