import { Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as cdk from 'aws-cdk-lib';
import dynamodb = require('aws-cdk-lib/aws-dynamodb');
import lambda = require('aws-cdk-lib/aws-lambda');
import apigw = require('aws-cdk-lib/aws-apigateway');
import sfn = require('aws-cdk-lib/aws-stepfunctions');
import tasks = require('aws-cdk-lib/aws-stepfunctions-tasks');
import { ConfirmPermissionsBroadening } from 'aws-cdk-lib/pipelines';

export class AwsStepfunctionHolidayBookingCdkStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    /**
     * DynamoDB Table
     *
     * We store Flight, Hotel and Rental Car bookings in the same table.
     *
     * For more help with single table DB structures see - https://www.dynamodbbook.com/
     *
     * pk - the trip_id e.g. 1234
     * sk - bookingtype#booking_id e.g. HOTEL#345634, FLIGHT#574576, PAYMENT#45245
     */

    const bookingsTable = new dynamodb.Table(this, 'Bookings', {
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
    });

    /**
     * Lambda Functions
     *
     * We need Booking and Cancellation functions for our 3 services
     * All functions need access to our DynamoDB table above.
     *
     * We also need to take payment for this trip
     *
     * 1 Flights
     * 2 Hotel
     * 3 Payment
     */

    /// 1 Flights

    const reserveFlightLambda = this.createLambda(
      this,
      'reserveFlightLambdaHandler',
      'reserveFlight.handler',
      bookingsTable
    );

    const confirmFlightLambda = this.createLambda(
      this,
      'confirmFlightLambdaHandler',
      'confirmFlight.handler',
      bookingsTable
    );

    const cancelFlightLambda = this.createLambda(
      this,
      'cancelFlightLambdaHandler',
      'cancelFlight.handler',
      bookingsTable
    );

    /// 2 Hotel

    const reserveHotelLambda = this.createLambda(
      this,
      'reserveHotelLambdaHandler',
      'reserveHotel.handler',
      bookingsTable
    );

    const confirmHotelLambda = this.createLambda(
      this,
      'confirmHotelLambdaHandler',
      'confirmHotel.handler',
      bookingsTable
    );

    const cancelHotelLambda = this.createLambda(
      this,
      'cancelHotelLambdaHandler',
      'cancelHotel.handler',
      bookingsTable
    );

    /// 3 Payment For Holiday

    const takePaymentLambda = this.createLambda(
      this,
      'takePaymentLambdaHandler',
      'takePayment.handler',
      bookingsTable
    );

    const refundPaymentLambda = this.createLambda(
      this,
      'refundPaymentLambdaHandler',
      'refundPayment.handler',
      bookingsTable
    );

    /**
     * Saga Pattern Stepfunction
     *
     * Follows a strict order:
     * 1 Reserve Flights and Hotel
     * 2 Take Payment
     * 3 Confirm Flight and Hotel booking
     */

    // Our two end states

    const bookingFailed = new sfn.Fail(
      this,
      "Sorry, We Couldn't make the booking",
      {}
    );

    const bookingSucceeded = new sfn.Succeed(
      this,
      'We have made your booking!'
    );

    /// 1 Reserve Flights and Hotel

    console.log('Create cancelHotelReservation Task');

    const cancelHotelReservation = new tasks.LambdaInvoke(
      this,
      'CancelHotelReservation',
      {
        lambdaFunction: cancelHotelLambda,
        resultPath: '$.CancelHotelReservationResult',
      }
    )
      .addRetry({ maxAttempts: 3 }) // retry this task a max of 3 times if it fails
      .next(bookingFailed);

    console.log('Create reserveHotel Task');

    const reserveHotel = new tasks.LambdaInvoke(this, 'ReserveHotel', {
      lambdaFunction: reserveHotelLambda,
      resultPath: '$.ReserveHotelResult',
    }).addCatch(cancelHotelReservation, {
      resultPath: '$.ReserveHotelError',
    });

    console.log('Create cancelFlightReservation Task');

    const cancelFlightReservation = new tasks.LambdaInvoke(
      this,
      'CancelFlightReservation',
      {
        lambdaFunction: cancelFlightLambda,
        resultPath: '$.CancelFlightReservationResult',
      }
    )
      .addRetry({ maxAttempts: 3 }) // retry this task a max of 3 times if it fails
      .next(cancelHotelReservation);

    console.log('Create reserveFlight Task');

    const reserveFlight = new tasks.LambdaInvoke(this, 'ReserveFlight', {
      lambdaFunction: reserveFlightLambda,
      resultPath: '$.ReserveFlightResult',
    }).addCatch(cancelFlightReservation, {
      resultPath: '$.ReserveFlightError',
    });

    /// 2 Take Payment

    console.log('Create refundPayment Task');

    const refundPayment = new tasks.LambdaInvoke(this, 'RefundPayment', {
      lambdaFunction: refundPaymentLambda,
      resultPath: '$.RefundPaymentResult',
    })
      .addRetry({ maxAttempts: 3 }) // retry this task a max of 3 times if it fails
      .next(cancelFlightReservation);

    console.log('Create takePayment Task');

    const takePayment = new tasks.LambdaInvoke(this, 'TakePayment', {
      lambdaFunction: takePaymentLambda,
      resultPath: '$.TakePaymentResult',
    }).addCatch(cancelFlightReservation, {
      resultPath: '$.TakePaymentError',
    });

    /// 3 Confirm Flight and Hotel booking

    console.log('Create confirmHotelBooking Task');

    const confirmHotelBooking = new tasks.LambdaInvoke(
      this,
      'ConfirmHotelBooking',
      {
        lambdaFunction: confirmHotelLambda,
        resultPath: '$.ConfirmHotelBookingResult',
      }
    ).addCatch(refundPayment, {
      resultPath: '$.ConfirmHotelBookingError',
    });

    console.log('Create confirmFlight Task');

    const confirmFlight = new tasks.LambdaInvoke(this, 'ConfirmFlight', {
      lambdaFunction: confirmFlightLambda,
      resultPath: '$.ConfirmFlightResult',
    }).addCatch(refundPayment, {
      resultPath: '$.ConfirmFlightError',
    });

    /// Step function definition

    const definition = sfn.Chain.start(reserveHotel)
      .next(reserveFlight)
      .next(takePayment)
      .next(confirmHotelBooking)
      .next(confirmFlight)
      .next(bookingSucceeded);

    let saga = new sfn.StateMachine(this, 'BookingSaga', {
      definition,
      timeout: cdk.Duration.minutes(5),
    });

    /// defines an AWS Lambda resource to connect to our API Gateway and kick
    /// off our step function

    console.log('Create holidayBookingLambda Lambda');

    const holidayBookingLambda = new lambda.Function(
      this,
      'sagaLambdaHandler',
      {
        runtime: lambda.Runtime.NODEJS_14_X,
        code: lambda.Code.fromAsset('lambda'),
        handler: 'sagaLambda.handler',
        environment: {
          statemachine_arn: saga.stateMachineArn,
        },
      }
    );

    console.log('Lambda created');

    saga.grantStartExecution(holidayBookingLambda);

    /// Simple API Gateway proxy integration
    /// defines an API Gateway REST API resource backed by our "stateMachineLambda" function.

    new apigw.LambdaRestApi(this, 'HolidayBooking', {
      handler: holidayBookingLambda,
    });
  }

  /**
   * Helper function to shorten Lambda boilerplate as we have 6 in this stack
   * @param scope
   * @param id
   * @param handler
   * @param table
   */
  createLambda(
    scope: Stack,
    id: string,
    handler: string,
    table: dynamodb.Table
  ) {
    console.log('createLambda', handler);

    // Create a Node Lambda with the table name passed in as an environment variable

    const fn = new lambda.Function(scope, id, {
      runtime: lambda.Runtime.NODEJS_14_X,
      code: lambda.Code.fromAsset('lambda'),
      handler: handler,
      environment: {
        TABLE_NAME: table.tableName,
      },
    });

    // Give our Lambda permissions to read and write data from the passed in DynamoDB table

    table.grantReadWriteData(fn);

    console.log('createLambda complete');

    return fn;
  }
}
