const { CronJob } = require('cron')
const parseDuration = require('parse-duration')

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
	const { id, cron, duration, limit = 0 } = event.detail

	if (!id) {
		throw new Error('Invalid required property id supplied')
	}

	if (!cron && !duration) {
		throw new Error('Invalid required properties cron or duration')
	}

	let schedule = {
		id,
		limit,
		cron,
		duration,
		counter: 0
	}

	let nextDate = new Date()

	if (cron) {
		const cronJob = new CronJob(cron)
		nextDate = cronJob.nextDate().toJSDate()
	} else if (duration) {
		const milliseconds = parseDuration(duration)
		nextDate = new Date(nextDate.getTime() + milliseconds)
	} else {
		throw new Error('Cannot elaborate next date')
	}

	const { Item: existingSchedule } = await db.get({
		TableName: process.env.TABLE_NAME,
		Key: {
			id
		}
	}).promise()

	if (existingSchedule && existingSchedule.executionArn) {
		const currentExecution = await stepFunctions.describeExecution({
			executionArn: existingSchedule.executionArn
		}).promise()

		if (currentExecution.status === 'RUNNING') {
			await stepFunctions.stopExecution({
				executionArn: existingSchedule.executionArn,
				error: 'ScheduleOverlap'
			}).promise()
		}
	}

	const execution = await stepFunctions.startExecution({
		stateMachineArn: process.env.STATE_MACHINE_ARN,
		input: JSON.stringify({
			timestamp: nextDate.toISOString(),
			schedule
		})
	}).promise()

	schedule = Object.assign(schedule, {
		executionArn: execution.executionArn,
		startDate: execution.startDate.toISOString(),
		nextTickDate: nextDate.toISOString()
	})

	await db.put({
		TableName: process.env.TABLE_NAME,
		Item: schedule
	}).promise()

	await eventBridge.putEvents({
		Entries: [{
			EventBusName: process.env.EVENT_BUS_NAME,
			Source: process.env.EVENT_SOURCE,
			DetailType: 'Schedule Started',
			Detail: JSON.stringify(schedule)
		}]
	}).promise()
}
